import { select } from '../../shared/prompts.js'
import { withSpinner } from '../../shared/spinner.js'
import { createWorkflowItemVersion, loadWorkflowReleaseContext, newVersionCandidates } from '../shared/release.js'
import {
  type WorkflowResourceManifest,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace,
  workflowItemName
} from '../shared/resource.js'
import { workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

export function workflowNewVersionFlags() {
  return { directory: workflowDirectoryFlag() }
}

export interface WorkflowNewVersionInput {
  selector?: string
  directory: string
}

export abstract class WorkflowNewVersionCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async newVersion(options: WorkflowNewVersionInput): Promise<unknown> {
    const { singular } = this.resource
    if (!options.selector && !this.interactive) {
      this.error(`Pass the ${singular} key when running non-interactively.`)
    }
    const context = await withSpinner(
      `Checking workflow ${singular} versions...`,
      () => loadWorkflowReleaseContext(this.resource, options.directory, { purpose: 'new-version' }),
      this.spinnerOptions
    )
    const eligible = newVersionCandidates(this.resource.items(context.remote))
    if (!options.selector && eligible.length === 0) {
      throw new Error(`No published workflow ${singular} is eligible for a new version.`)
    }
    const selector =
      options.selector ??
      (await select({
        message: `Published workflow ${singular}:`,
        choices: eligible.map(item => ({ name: `${workflowItemName(item)} (${item.key})`, value: item.key }))
      }))
    const created = await withSpinner(
      `Creating workflow ${singular} version...`,
      () => createWorkflowItemVersion(this.resource, context, selector),
      this.spinnerOptions
    )
    const result = { appId: context.appId, key: created.key, version: created.version, files: created.files }
    if (this.jsonEnabled()) return result
    this.log(
      `Created draft ${created.version} for "${created.key}" and refreshed ${this.resource.filesDirectory(created.files)}.`
    )
  }
}
