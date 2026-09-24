import { Args, Flags } from '@oclif/core'

import { confirm, select } from '../../shared/prompts.js'
import {
  findWorkflowItem,
  type WorkflowResourceManifest,
  type WorkflowResourceNaming,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace,
  workflowItemName
} from '../shared/resource.js'
import { capitalize, workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

export function workflowSelectorArgs(resource: WorkflowResourceNaming) {
  return {
    [resource.singular]: Args.string({
      description: `${capitalize(resource.singular)} key or template id (prompted interactively when omitted)`
    })
  }
}

export function workflowDeleteFlags() {
  return {
    directory: workflowDirectoryFlag(),
    force: Flags.boolean({ description: 'Confirm the local removal without prompting' })
  }
}

export interface WorkflowDeleteInput {
  selector?: string
  directory: string
  force: boolean
}

export abstract class WorkflowDeleteCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async delete(options: WorkflowDeleteInput): Promise<unknown> {
    const { singular, plural } = this.resource
    if (!options.selector && !this.interactive) {
      this.error(`Pass the ${singular} key and --force when running non-interactively.`)
    }
    const workspace = await this.resource.loadWorkspace(options.directory)
    const items = this.resource.items(workspace.manifest)
    if (items.length === 0) throw new Error(`This app has no workflow ${plural} to delete.`)
    const selector =
      options.selector ??
      (await select({
        message: `Workflow ${singular} to remove:`,
        choices: items.map(item => ({ name: `${workflowItemName(item)} (${item.key})`, value: item.key }))
      }))
    const item = findWorkflowItem(items, selector)
    if (!item) throw new Error(`Workflow ${singular} "${selector}" was not found in local JSON.`)
    if (!options.force) {
      if (!this.interactive) throw new Error(`Pass --force to remove a workflow ${singular} non-interactively.`)
      const approved = await confirm({ message: `Remove "${workflowItemName(item)}" from local JSON?`, default: false })
      if (!approved) {
        this.log('Cancelled — nothing was changed.')
        return
      }
    }
    const manifest = this.resource.withoutItem(workspace.manifest, item.key)
    const staged = await this.resource.writeStagedSources(workspace, manifest)
    const result = {
      appId: manifest.appId,
      key: item.key,
      [`${singular}Directory`]: staged.directory,
      stagedDeletion: true
    }
    if (this.jsonEnabled()) return result
    this.log(
      `Removed "${item.key}" from ${staged.directory}. Run \`ghl app ${plural} push --force\` to apply the deletion.`
    )
  }
}
