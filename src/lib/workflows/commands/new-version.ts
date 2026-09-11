import { select } from '../../shared/prompts.js'
import { withSpinner } from '../../shared/spinner.js'
import {
  findWorkflowItem,
  hasDraftVersion,
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
      () => this.loadSyncContext(options.directory),
      this.spinnerOptions
    )
    const planError = this.planError(context.plan)
    if (planError) throw planError
    if (context.plan.localChanges.length > 0) {
      throw new Error(`Push or discard local workflow ${singular} changes before creating a new version.`)
    }
    const items = this.resource.items(context.remote)
    const eligible = items.filter(item => !hasDraftVersion(item) && item.versions[0]?.status === 'published')
    if (!options.selector && eligible.length === 0) {
      throw new Error(`No published workflow ${singular} is eligible for a new version.`)
    }
    const selector =
      options.selector ??
      (await select({
        message: `Published workflow ${singular}:`,
        choices: eligible.map(item => ({ name: `${workflowItemName(item)} (${item.key})`, value: item.key }))
      }))
    const item = findWorkflowItem(items, selector)
    const templateId = item?.templateId
    if (!item || !templateId) throw new Error(`Workflow ${singular} "${selector}" was not found.`)
    if (hasDraftVersion(item)) throw new Error(`Workflow ${singular} "${item.key}" already has a draft version.`)
    if (item.versions[0]?.status !== 'published') {
      throw new Error(
        `Workflow ${singular} "${item.key}" must have a latest published version before creating a new draft.`
      )
    }
    const created = await withSpinner(
      `Creating workflow ${singular} version...`,
      () => this.resource.createVersion(context.client, context.appId, templateId),
      this.spinnerOptions
    )
    const remote = await this.fetchManifest(context.client, context.appId)
    const files = await this.resource.writeWorkspace(context.directory, remote)
    const result = { appId: context.appId, key: item.key, version: created.version, files }
    if (this.jsonEnabled()) return result
    this.log(`Created draft ${created.version} for "${item.key}" and refreshed ${this.resource.filesDirectory(files)}.`)
  }
}
