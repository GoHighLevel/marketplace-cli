import { Flags } from '@oclif/core'

import { GhlCommand } from '../../shared/command.js'
import { loadWorkflowSyncContext, workflowPlanError, type WorkflowSyncContextOptions } from '../shared/context.js'
import {
  type WorkflowResource,
  type WorkflowResourceManifest,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function workflowDirectoryFlag() {
  return Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
}

/* Shared plumbing for every resource-parameterized workflow command. */
export abstract class WorkflowResourceCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends GhlCommand {
  protected abstract readonly resource: WorkflowResource<M, P, W, F, S>

  protected get spinnerOptions(): { quiet: boolean } {
    return { quiet: this.jsonEnabled() }
  }

  protected get interactive(): boolean {
    return process.stdin.isTTY === true && !this.jsonEnabled()
  }

  protected loadSyncContext(directory: string, options?: WorkflowSyncContextOptions) {
    return loadWorkflowSyncContext(this.resource, directory, options)
  }

  protected planError(plan: P): Error | undefined {
    return workflowPlanError(this.resource, plan)
  }

  protected async fetchManifest(
    client: Parameters<WorkflowResource<M, P, W, F, S>['fetchSnapshot']>[0],
    appId: string
  ) {
    return (await this.resource.fetchSnapshot(client, appId)).manifest
  }
}
