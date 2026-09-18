import { Flags } from '@oclif/core'

import {
  type WorkflowResourceManifest,
  type WorkflowResourceNaming,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { capitalize, workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

export function workflowValidateFlags(resource: WorkflowResourceNaming) {
  const noun = capitalize(resource.singular)
  return {
    directory: workflowDirectoryFlag(),
    publishable: Flags.boolean({ description: `Also enforce submission requirements for draft ${resource.plural}` }),
    [resource.singular]: Flags.string({
      description: `${noun} key to check with --publishable`,
      dependsOn: ['publishable']
    }),
    version: Flags.string({
      description: `${noun} version to check with --publishable`,
      dependsOn: ['publishable', resource.singular]
    })
  }
}

export interface WorkflowValidateInput {
  directory: string
  publishable: boolean
  key?: string
  version?: string
}

export abstract class WorkflowValidateCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async validate(options: WorkflowValidateInput): Promise<unknown> {
    const { singular, plural, label } = this.resource
    const workspace = await this.resource.loadWorkspace(options.directory)
    const errors = [
      ...this.resource.validateManifest(workspace.manifest, {
        publishable: options.publishable,
        key: options.key,
        version: options.version
      }),
      ...this.resource.prerequisiteErrors(workspace)
    ]
    if (errors.length > 0) throw new Error(`${label} configuration is invalid:\n- ${errors.join('\n- ')}`)
    const count = this.resource.items(workspace.manifest).length
    const result = { valid: true, appId: workspace.manifest.appId, [plural]: count, errors: [] }
    if (this.jsonEnabled()) return result
    this.log(`${label} configuration is valid (${count} ${singular}(s)).`)
  }
}
