import { Args, Flags } from '@oclif/core'

import { input } from '../../shared/prompts.js'
import {
  type WorkflowResourceManifest,
  type WorkflowResourceNaming,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { scaffoldWorkflowItem, WORKFLOW_KEY_PATTERN, WORKFLOW_KEY_RULE } from '../shared/scaffold.js'
import { capitalize, workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

export function workflowCreateArgs(resource: WorkflowResourceNaming) {
  return {
    name: Args.string({ description: `${capitalize(resource.singular)} name (prompted interactively when omitted)` })
  }
}

export function workflowCreateFlags(resource: WorkflowResourceNaming) {
  return {
    key: Flags.string({
      description: `Stable ${resource.singular} key using lowercase letters, numbers, and underscores`
    }),
    directory: workflowDirectoryFlag(),
    ...(resource.plural === 'actions'
      ? {
          typescript: Flags.boolean({
            description: 'Create a typed action handler and transpile it to JavaScript when pushing',
            default: false
          })
        }
      : {})
  }
}

export interface WorkflowCreateInput {
  name?: string
  key?: string
  directory: string
  typescript?: boolean
}

export abstract class WorkflowCreateCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async create(options: WorkflowCreateInput): Promise<unknown> {
    const { singular, plural } = this.resource
    const noun = capitalize(singular)
    if ((!options.name || !options.key) && !this.interactive) {
      this.error(`Pass the ${singular} name and --key when running non-interactively.`)
    }
    const workspace = await this.resource.loadWorkspace(options.directory)
    const name =
      options.name ??
      (await input({
        message: `${noun} name:`,
        validate: value => (value.trim() ? true : `${noun} name is required.`)
      }))
    const key =
      options.key ??
      (await input({
        message: `${noun} key:`,
        validate: value => (WORKFLOW_KEY_PATTERN.test(value) ? true : WORKFLOW_KEY_RULE)
      }))
    const created = await scaffoldWorkflowItem(this.resource, workspace, { name, key, typescript: options.typescript })
    const result = {
      appId: created.appId,
      key: created.key,
      name: created.name,
      [`${singular}File`]: created.file,
      staged: true
    }
    if (this.jsonEnabled()) return result
    this.log(`Added "${created.name}" to ${created.file}. Run \`ghl app ${plural} push\` to create it in the portal.`)
  }
}
