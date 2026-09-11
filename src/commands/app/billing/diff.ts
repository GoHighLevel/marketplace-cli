import { Command, Flags } from '@oclif/core'

import { loadBillingSyncContext } from '../../../lib/billing/command-context.js'
import { billingSubscriptionOperationLabel, billingUsageOperationLabel } from '../../../lib/billing/service.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppBillingDiff extends Command {
  static description = 'Compare local billing JSON with the last pull and current portal state'

  static examples = [
    '<%= config.bin %> app billing diff',
    '<%= config.bin %> app billing diff --directory ./my-app --json'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppBillingDiff)
    try {
      const context = await withSpinner(
        'Comparing billing configuration...',
        () => loadBillingSyncContext(flags.directory),
        { quiet: this.jsonEnabled() }
      )
      const localChanges = [
        ...context.subscriptionPlan.localChanges.map(path => `subscription.${path}`),
        ...context.usagePlan.localChanges.map(path => `usage.${path}`)
      ]
      const portalChanges = [
        ...context.subscriptionPlan.remoteChanges.map(path => `subscription.${path}`),
        ...context.usagePlan.remoteChanges.map(path => `usage.${path}`)
      ]
      const conflicts = [...context.subscriptionPlan.conflicts, ...context.usagePlan.conflicts]
      const errors = [...context.subscriptionPlan.errors, ...context.usagePlan.errors]
      const operations = [
        ...context.subscriptionPlan.operations.map(billingSubscriptionOperationLabel),
        ...context.usagePlan.operations.map(billingUsageOperationLabel)
      ]
      const result = { appId: context.appId, localChanges, portalChanges, conflicts, errors, operations }
      if (this.jsonEnabled()) {
        if (conflicts.length > 0 || errors.length > 0) process.exitCode = 1
        return result
      }
      this.log(`Local changes: ${localChanges.length}`)
      for (const change of localChanges) this.log(`  local    ${change}`)
      this.log(`Portal changes: ${portalChanges.length}`)
      for (const change of portalChanges) this.log(`  portal   ${change}`)
      for (const conflict of conflicts) this.log(`  conflict ${conflict}`)
      for (const error of errors) this.log(`  invalid  ${error}`)
      this.log(`API operations: ${operations.join(', ') || 'none'}`)
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to compare billing configuration.')
    }
  }
}
