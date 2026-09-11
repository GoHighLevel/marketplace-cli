import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { confirm } from '../../../lib/shared/prompts.js'
import {
  loadWorkflowTriggersSyncContext,
  workflowTriggersPlanError
} from '../../../lib/workflows/triggers/command-context.js'
import {
  executeWorkflowTriggersSyncPlanIndependently,
  fetchWorkflowTriggersManifest,
  reconcileWorkflowTriggersAfterPush,
  verifyWorkflowTriggersApplied,
  workflowTriggerOperationLabel
} from '../../../lib/workflows/triggers/service.js'
import { writeWorkflowTriggersWorkspace } from '../../../lib/workflows/triggers/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppTriggersPush extends GhlCommand {
  static description = 'Validate all trigger files and independently push each changed workflow trigger'

  static examples = [
    '<%= config.bin %> app triggers push',
    '<%= config.bin %> app triggers push --dry-run --json',
    '<%= config.bin %> app triggers push --force'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    'dry-run': Flags.boolean({ description: 'Validate and show the API plan without changing remote or local files' }),
    force: Flags.boolean({ description: 'Confirm trigger deletions without prompting' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppTriggersPush)
    const context = await withSpinner(
      'Validating and planning workflow trigger push...',
      () => loadWorkflowTriggersSyncContext(flags.directory, { requirePrerequisites: true }),
      { quiet: this.jsonEnabled() }
    )
    const planError = workflowTriggersPlanError(context.plan)
    if (planError) throw planError
    const deletions = context.plan.operations.filter(operation => operation.type === 'delete')
    if (!flags['dry-run'] && deletions.length > 0 && !flags.force) {
      if (!process.stdin.isTTY || this.jsonEnabled()) {
        throw new Error('Workflow trigger deletions require --force when running non-interactively.')
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
    if (flags['dry-run']) {
      const result = {
        dryRun: true,
        appId: context.appId,
        operations: context.plan.operations.map(operation => ({ type: operation.type, key: operation.key })),
        changes: context.plan.localChanges
      }
      if (this.jsonEnabled()) return result
      this.log(
        `Validation passed. API operations: ${result.operations.map(operation => `${operation.type}:${operation.key}`).join(', ') || 'none'}.`
      )
      return
    }
    const execution = await withSpinner(
      'Pushing workflow triggers...',
      () => executeWorkflowTriggersSyncPlanIndependently(context.client, context.plan, { runtime: context.runtime }),
      { quiet: this.jsonEnabled() }
    )
    const remote =
      execution.total > 0 ? await fetchWorkflowTriggersManifest(context.client, context.appId) : context.remote
    const successfulOperations = new Set(
      execution.results.filter(result => result.success).map(result => result.operation)
    )
    const verificationPlan = {
      ...context.plan,
      operations: context.plan.operations.filter(operation =>
        successfulOperations.has(workflowTriggerOperationLabel(operation))
      )
    }
    const mismatches = new Set(verifyWorkflowTriggersApplied(verificationPlan, remote))
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
    const local = reconcileWorkflowTriggersAfterPush(context.local.manifest, remote, failedKeys)
    const files = await writeWorkflowTriggersWorkspace(context.directory, local, remote)
    const result = { appId: context.appId, ...execution, files }
    if (execution.failed > 0) process.exitCode = 1
    if (this.jsonEnabled()) return result
    this.log(`Workflow trigger push complete: ${execution.succeeded} succeeded, ${execution.failed} failed.`)
    for (const item of execution.results) {
      this.log(`  ${item.success ? 'succeeded' : 'failed'}  ${item.operation}${item.error ? ` — ${item.error}` : ''}`)
    }
  }
}
