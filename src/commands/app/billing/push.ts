import { Command, Flags } from '@oclif/core'

import { billingPlanError, loadBillingSyncContext } from '../../../lib/billing/command-context.js'
import {
  billingSubscriptionOperationLabel,
  billingUsageOperationLabel,
  executeBillingSyncPlans,
  fetchBillingSnapshot,
  reconcileBillingAfterPush,
  verifyBillingOperations
} from '../../../lib/billing/service.js'
import { synchronizeUsageBillingSummary, writeBillingWorkspace } from '../../../lib/billing/workspace.js'
import { confirm, isPromptCancel } from '../../../lib/shared/prompts.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppBillingPush extends Command {
  static description = 'Validate and independently push changed subscription plans and usage meters'

  static examples = [
    '<%= config.bin %> app billing push',
    '<%= config.bin %> app billing push --dry-run --json',
    '<%= config.bin %> app billing push --force'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    'dry-run': Flags.boolean({ description: 'Validate and show the API plan without changing remote or local files' }),
    force: Flags.boolean({ description: 'Confirm billing deletions without prompting' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppBillingPush)
    try {
      const context = await withSpinner(
        'Validating and planning billing push...',
        () => loadBillingSyncContext(flags.directory),
        { quiet: this.jsonEnabled() }
      )
      const planError = billingPlanError(context.subscriptionPlan, context.usagePlan)
      if (planError) throw planError
      const operationLabels = [
        ...context.subscriptionPlan.operations.map(billingSubscriptionOperationLabel),
        ...context.usagePlan.operations.map(billingUsageOperationLabel)
      ]
      const deletions = operationLabels.filter(label => label.startsWith('delete-'))
      if (!flags['dry-run'] && deletions.length > 0 && !flags.force) {
        if (!process.stdin.isTTY || this.jsonEnabled()) {
          throw new Error('Billing deletions require --force when running non-interactively.')
        }
        const approved = await confirm({
          message: `Apply ${deletions.length} billing deletion(s)?`,
          default: false
        })
        if (!approved) {
          this.log('Cancelled — nothing was changed.')
          return
        }
      }
      if (flags['dry-run']) {
        const result = { dryRun: true, appId: context.appId, operations: operationLabels }
        if (this.jsonEnabled()) return result
        this.log(`Validation passed. API operations: ${operationLabels.join(', ') || 'none'}.`)
        return
      }

      const execution = await withSpinner(
        'Pushing billing configuration...',
        () => executeBillingSyncPlans(context.client, context.subscriptionPlan, context.usagePlan),
        { quiet: this.jsonEnabled() }
      )
      try {
        const remote = execution.total > 0 ? await fetchBillingSnapshot(context.client, context.appId) : context.remote
        const succeeded = new Set(execution.results.filter(result => result.success).map(result => result.operation))
        const verificationSubscriptions = {
          ...context.subscriptionPlan,
          operations: context.subscriptionPlan.operations.filter(operation =>
            succeeded.has(billingSubscriptionOperationLabel(operation))
          )
        }
        const verificationUsage = {
          ...context.usagePlan,
          operations: context.usagePlan.operations.filter(operation =>
            succeeded.has(billingUsageOperationLabel(operation))
          )
        }
        const mismatches = new Set(verifyBillingOperations(verificationSubscriptions, verificationUsage, remote))
        for (const result of execution.results) {
          if (result.success && mismatches.has(result.operation)) {
            result.success = false
            result.error = 'The portal state did not match the requested configuration after the API call.'
          }
        }
        execution.applied = execution.results.filter(result => result.success).map(result => result.operation)
        execution.succeeded = execution.applied.length
        execution.failed = execution.total - execution.succeeded
        const failed = new Set(execution.results.filter(result => !result.success).map(result => result.operation))
        const local = reconcileBillingAfterPush(
          { subscriptions: context.local.subscriptions, usage: context.local.usage },
          remote,
          context.subscriptionPlan,
          context.usagePlan,
          failed
        )
        const files = await writeBillingWorkspace(context.directory, local.subscriptions, local.usage, remote)
        await synchronizeUsageBillingSummary(context.directory, remote.usage.meters.length > 0)
        const result = { appId: context.appId, ...execution, files }
        if (execution.failed > 0) process.exitCode = 1
        if (this.jsonEnabled()) return result
        if (execution.total === 0) {
          this.log('No billing API updates were required; local files are synchronized.')
          return
        }
        this.log(`Billing push complete: ${execution.succeeded} succeeded, ${execution.failed} failed.`)
        for (const item of execution.results) {
          this.log(
            `  ${item.success ? 'succeeded' : 'failed'}  ${item.operation}${item.error ? ` — ${item.error}` : ''}`
          )
        }
        return
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'local synchronization failed'
        throw new Error(
          `The billing API push completed, but verification or local synchronization failed: ${reason}. ` +
            'Run `ghl app billing pull` before making more changes.'
        )
      }
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to push billing configuration.')
    }
  }
}
