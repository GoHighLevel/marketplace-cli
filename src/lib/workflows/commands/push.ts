import { Flags } from '@oclif/core'

import { confirm } from '../../shared/prompts.js'
import { withSpinner } from '../../shared/spinner.js'
import { applyWorkflowPush, planWorkflowPush } from '../shared/push.js'
import {
  type WorkflowResourceManifest,
  type WorkflowResourceNaming,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

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
      () => planWorkflowPush(this.resource, options.directory),
      this.spinnerOptions
    )
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

    const { execution: verified, files } = await withSpinner(
      `Pushing workflow ${plural}...`,
      () => applyWorkflowPush(this.resource, context),
      this.spinnerOptions
    )
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
  }
}
