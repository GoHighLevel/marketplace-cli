import { withSpinner } from '../../shared/spinner.js'
import {
  type WorkflowResourceManifest,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

export function workflowDiffFlags() {
  return { directory: workflowDirectoryFlag() }
}

export interface WorkflowDiffInput {
  directory: string
}

export abstract class WorkflowDiffCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async diff(options: WorkflowDiffInput): Promise<unknown> {
    const context = await withSpinner(
      `Comparing workflow ${this.resource.plural}...`,
      () => this.loadSyncContext(options.directory),
      this.spinnerOptions
    )
    const result = {
      appId: context.appId,
      localChanges: context.plan.localChanges,
      portalChanges: context.plan.remoteChanges,
      conflicts: context.plan.conflicts,
      errors: context.plan.errors,
      operations: context.plan.operations.map(operation => ({ type: operation.type, key: operation.key }))
    }
    if (this.jsonEnabled()) return result
    this.log(`Local changes: ${result.localChanges.length}`)
    for (const change of result.localChanges) this.log(`  local   ${change}`)
    this.log(`Portal changes: ${result.portalChanges.length}`)
    for (const change of result.portalChanges) this.log(`  portal  ${change}`)
    this.log(`Conflicts: ${result.conflicts.length}`)
    for (const conflict of result.conflicts) this.log(`  conflict ${conflict}`)
    for (const error of result.errors) this.log(`  invalid  ${error}`)
    this.log(
      `API operations: ${result.operations.map(operation => `${operation.type}:${operation.key}`).join(', ') || 'none'}`
    )
  }
}
