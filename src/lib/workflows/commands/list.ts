import { Flags } from '@oclif/core'

import { renderTable } from '../../shared/table.js'
import { withSpinner } from '../../shared/spinner.js'
import { loadWorkflowRemoteContext } from '../shared/context.js'
import {
  type WorkflowResourceManifest,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { WorkflowResourceCommand } from './base.js'

export function workflowListFlags() {
  return {
    app: Flags.string({ description: 'App id (defaults to the current workspace or selected app)' }),
    directory: Flags.string({ description: 'App workspace directory used to resolve the app id', default: '.' })
  }
}

export interface WorkflowListInput {
  app?: string
  directory: string
}

export abstract class WorkflowListCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async list(options: WorkflowListInput): Promise<unknown> {
    const { plural, singular } = this.resource
    const context = await loadWorkflowRemoteContext({ appId: options.app, directory: options.directory })
    const summaries = await withSpinner(
      `Loading workflow ${plural}...`,
      () => this.resource.listSummaries(context.client, context.appId),
      this.spinnerOptions
    )
    if (this.jsonEnabled()) return { appId: context.appId, [plural]: summaries }
    if (summaries.length === 0) {
      this.log(`No workflow ${plural} are registered for this app.`)
      return
    }
    const rows = summaries.map(summary => this.resource.summaryRow(summary))
    this.log(
      renderTable(
        [`${singular.toUpperCase()} ID`, 'NAME', 'VERSION', 'STATUS'],
        rows.map(row => [row.id, row.name, row.version, row.status])
      )
    )
  }
}
