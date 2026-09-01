import { Command, Flags } from '@oclif/core'

import { confirm, isPromptCancel } from '../../../lib/shared/prompts.js'
import {
  loadWorkflowActionsSyncContext,
  workflowActionsPlanError
} from '../../../lib/workflows/actions/command-context.js'
import {
  executeWorkflowActionsSyncPlanIndependently,
  fetchWorkflowActionsManifest,
  reconcileWorkflowActionsAfterPush,
  verifyWorkflowActionsApplied,
  workflowActionOperationLabel
} from '../../../lib/workflows/actions/service.js'
import { writeWorkflowActionsWorkspace } from '../../../lib/workflows/actions/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppActionsPush extends Command {
  static description = 'Validate all action files and independently push each changed workflow action'

  static examples = [
    '<%= config.bin %> app actions push',
    '<%= config.bin %> app actions push --dry-run --json',
    '<%= config.bin %> app actions push --force'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    'dry-run': Flags.boolean({ description: 'Validate and show the API plan without changing remote or local files' }),
    force: Flags.boolean({ description: 'Confirm action deletions without prompting' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppActionsPush)
    try {
      const context = await withSpinner(
        'Validating and planning workflow action push...',
        () => loadWorkflowActionsSyncContext(flags.directory, { requirePrerequisites: true }),
        { quiet: this.jsonEnabled() }
      )
      const planError = workflowActionsPlanError(context.plan)
      if (planError) throw planError
      const deletions = context.plan.operations.filter(operation => operation.type === 'delete')
      if (!flags['dry-run'] && deletions.length > 0 && !flags.force) {
        if (!process.stdin.isTTY || this.jsonEnabled()) {
          throw new Error('Workflow action deletions require --force when running non-interactively.')
        }
        const approved = await confirm({
          message: `Delete ${deletions.map(operation => operation.key).join(', ')} from the app?`,
          default: false
        })
        if (!approved) {
          this.log('Cancelled — nothing was changed.')
          return
        }
      }
      const operationSummary = context.plan.operations.map(operation => ({ type: operation.type, key: operation.key }))
      if (flags['dry-run']) {
        const result = { dryRun: true, appId: context.appId, operations: operationSummary, changes: context.plan.localChanges }
        if (this.jsonEnabled()) return result
        this.log(`Validation passed. API operations: ${operationSummary.map(operation => `${operation.type}:${operation.key}`).join(', ') || 'none'}.`)
        return
      }

      const execution = await withSpinner(
        'Pushing workflow actions...',
        () => executeWorkflowActionsSyncPlanIndependently(context.client, context.plan, { runtime: context.runtime }),
        { quiet: this.jsonEnabled() }
      )
      try {
        const remote = execution.total > 0
          ? await fetchWorkflowActionsManifest(context.client, context.appId)
          : context.remote
        const successfulOperations = new Set(
          execution.results.filter(result => result.success).map(result => result.operation)
        )
        const verificationPlan = {
          ...context.plan,
          operations: context.plan.operations.filter(operation =>
            successfulOperations.has(workflowActionOperationLabel(operation))
          )
        }
        const mismatches = new Set(verifyWorkflowActionsApplied(verificationPlan, remote))
        for (const result of execution.results) {
          if (result.success && mismatches.has(result.operation)) {
            result.success = false
            result.error = 'The portal state did not match the requested configuration after the API call.'
          }
        }
        execution.applied = execution.results.filter(result => result.success).map(result => result.operation)
        execution.succeeded = execution.applied.length
        execution.failed = execution.total - execution.succeeded
        const failedKeys = new Set(execution.results.filter(result => !result.success).map(result => result.key))
        const local = reconcileWorkflowActionsAfterPush(context.local.manifest, remote, failedKeys)
        const files = await writeWorkflowActionsWorkspace(context.directory, local, remote)
        const result = { appId: context.appId, ...execution, files }
        if (execution.failed > 0) process.exitCode = 1
        if (this.jsonEnabled()) return result
        if (execution.total === 0) {
          this.log('No workflow action API updates were required.')
          return
        }
        this.log(`Workflow action push complete: ${execution.succeeded} succeeded, ${execution.failed} failed.`)
        for (const item of execution.results) {
          this.log(`  ${item.success ? 'succeeded' : 'failed'}  ${item.operation}${item.error ? ` — ${item.error}` : ''}`)
        }
        return
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'local synchronization failed'
        throw new Error(
          `The workflow action API push completed, but verification or local synchronization failed: ${reason}. ` +
            'Run `ghl app actions pull` before making more changes.'
        )
      }
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to push workflow actions.')
    }
  }
}
