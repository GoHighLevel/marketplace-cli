import { Args, Flags } from '@oclif/core'

import { input } from '../../shared/prompts.js'
import {
  type WorkflowResourceManifest,
  type WorkflowResourceNaming,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { capitalize, workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

const KEY_PATTERN = /^[a-z][_a-z0-9]*$/

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
    directory: workflowDirectoryFlag()
  }
}

export interface WorkflowCreateInput {
  name?: string
  key?: string
  directory: string
}

export abstract class WorkflowCreateCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async create(options: WorkflowCreateInput): Promise<unknown> {
    const { singular, plural, label } = this.resource
    const noun = capitalize(singular)
    if ((!options.name || !options.key) && !this.interactive) {
      this.error(`Pass the ${singular} name and --key when running non-interactively.`)
    }
    const workspace = await this.resource.loadWorkspace(options.directory)
    const name = (
      options.name ??
      (await input({
        message: `${noun} name:`,
        validate: value => (value.trim() ? true : `${noun} name is required.`)
      }))
    ).trim()
    const key = (
      options.key ??
      (await input({
        message: `${noun} key:`,
        validate: value =>
          KEY_PATTERN.test(value) ? true : 'Use lowercase letters, numbers, and underscores, starting with a letter.'
      }))
    ).trim()
    const manifest = this.resource.withScaffold(workspace.manifest, name, key)
    const errors = this.resource.validateManifest(manifest)
    if (errors.length > 0) throw new Error(`${label} is invalid:\n- ${errors.join('\n- ')}`)
    const staged = await this.resource.writeStagedSources(workspace, manifest)
    const file = staged.files.find(candidate => candidate.endsWith(this.resource.filenameFromKey(key)))
    if (!file) throw new Error(`The workflow ${singular} file for "${key}" was not written.`)
    const result = { appId: manifest.appId, key, name, [`${singular}File`]: file, staged: true }
    if (this.jsonEnabled()) return result
    this.log(`Added "${name}" to ${file}. Run \`ghl app ${plural} push\` to create it in the portal.`)
  }
}
