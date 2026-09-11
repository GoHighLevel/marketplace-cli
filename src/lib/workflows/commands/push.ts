import { Flags } from '@oclif/core'

import { errorMessage } from '../../shared/errors.js'
import { confirm } from '../../shared/prompts.js'
import { withSpinner } from '../../shared/spinner.js'
import {
  type WorkflowResourceExecution,
  type WorkflowResourceManifest,
  type WorkflowResourceNaming,
  workflowOperationLabel,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

const VERIFICATION_MISMATCH = 'The portal state did not match the requested configuration after the API call.'

export function workflowPushFlags(resource: WorkflowResourceNaming) {
  return {
    directory: workflowDirectoryFlag(),
    'dry-run': Flags.boolean({ description: 'Validate and show the API plan without changing remote or local files' }),
    force: Flags.boolean({ description: `Confirm ${resource.singular} deletions without prompting` })
  }
}

export interface WorkflowPushInput {
  directory: string
  dryRun: boolean
  force: boolean
}

/* Operations whose API call succeeded but whose portal state does not match
   the request are reported as failures so the local baseline stays honest. */
export function withVerificationMismatches(
  execution: WorkflowResourceExecution,
  mismatches: Set<string>
): WorkflowResourceExecution {
  const results = execution.results.map(result =>
    result.success && mismatches.has(result.operation)
      ? { ...result, success: false, error: VERIFICATION_MISMATCH }
      : result
  )
  const applied = results.filter(result => result.success).map(result => result.operation)
  return {
    total: execution.total,
    succeeded: applied.length,
    failed: execution.total - applied.length,
    applied,
    results
  }
}

export abstract class WorkflowPushCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async push(options: WorkflowPushInput): Promise<unknown> {
    const { singular, plural } = this.resource
    const context = await withSpinner(
      `Validating and planning workflow ${singular} push...`,
      () => this.loadSyncContext(options.directory, { requirePrerequisites: true }),
      this.spinnerOptions
    )
    const planError = this.planError(context.plan)
    if (planError) throw planError
    const deletions = context.plan.operations.filter(operation => operation.type === 'delete')
    if (!options.dryRun && deletions.length > 0 && !options.force) {
      if (!this.interactive) {
        throw new Error(`Workflow ${singular} deletions require --force when running non-interactively.`)
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
    if (options.dryRun) {
      const result = {
        dryRun: true,
        appId: context.appId,
        operations: operationSummary,
        changes: context.plan.localChanges
      }
      if (this.jsonEnabled()) return result
      this.log(
        `Validation passed. API operations: ${operationSummary.map(operation => `${operation.type}:${operation.key}`).join(', ') || 'none'}.`
      )
      return
    }

    const execution = await withSpinner(
      `Pushing workflow ${plural}...`,
      () => this.resource.executePlan(context.client, context.plan, context.runtime),
      this.spinnerOptions
    )
    try {
      const remote = execution.total > 0 ? await this.fetchManifest(context.client, context.appId) : context.remote
      const successful = new Set(execution.results.filter(result => result.success).map(result => result.operation))
      const verificationPlan = {
        ...context.plan,
        operations: context.plan.operations.filter(operation => successful.has(workflowOperationLabel(operation)))
      }
      const verified = withVerificationMismatches(
        execution,
        new Set(this.resource.verifyApplied(verificationPlan, remote))
      )
      const failedKeys = new Set(verified.results.filter(result => !result.success).map(result => result.key))
      const local = this.resource.reconcileAfterPush(context.local.manifest, remote, failedKeys)
      const files = await this.resource.writeWorkspace(context.directory, local, remote)
      const result = { appId: context.appId, ...verified, files }
      if (verified.failed > 0) process.exitCode = 1
      if (this.jsonEnabled()) return result
      if (verified.total === 0) {
        this.log(`No workflow ${singular} API updates were required.`)
        return
      }
      this.log(`Workflow ${singular} push complete: ${verified.succeeded} succeeded, ${verified.failed} failed.`)
      for (const item of verified.results) {
        this.log(`  ${item.success ? 'succeeded' : 'failed'}  ${item.operation}${item.error ? ` — ${item.error}` : ''}`)
      }
    } catch (error) {
      throw new Error(
        `The workflow ${singular} API push completed, but verification or local synchronization failed: ` +
          `${errorMessage(error, 'local synchronization failed')}. Run \`ghl app ${plural} pull\` before making more changes.`
      )
    }
  }
}
