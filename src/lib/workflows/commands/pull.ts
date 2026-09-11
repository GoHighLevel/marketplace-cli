import { Flags } from '@oclif/core'

import { readPullWorkspaceBinding } from '../../../lib/app/pull.js'
import { withSpinner } from '../../shared/spinner.js'
import { loadWorkflowRemoteContext } from '../shared/context.js'
import {
  type WorkflowResourceManifest,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

export function workflowPullFlags() {
  return {
    app: Flags.string({ description: 'App id; must match the workspace app' }),
    directory: workflowDirectoryFlag()
  }
}

export interface WorkflowPullInput {
  app?: string
  directory: string
}

export abstract class WorkflowPullCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async pull(options: WorkflowPullInput): Promise<unknown> {
    const { singular, plural } = this.resource
    const binding = await readPullWorkspaceBinding(options.directory)
    if (!binding) {
      throw new Error('No ghl-app.json was found. Run this command inside an app workspace or pass --directory.')
    }
    const context = await loadWorkflowRemoteContext({
      appId: options.app,
      directory: binding.directory,
      requireWorkspaceMatch: true
    })
    const manifest = await withSpinner(
      `Pulling workflow ${plural}...`,
      () => this.fetchManifest(context.client, context.appId),
      this.spinnerOptions
    )
    const files = await this.resource.writeWorkspace(binding.directory, manifest)
    const count = this.resource.items(manifest).length
    if (this.jsonEnabled()) {
      return { appId: context.appId, [plural]: count, files: count > 0 ? files : this.resource.stateFiles(files) }
    }
    if (count === 0) {
      this.log(`Pulled 0 workflow ${plural}. No ${singular} directory was created.`)
    } else {
      this.log(`Pulled ${count} workflow ${singular}(s) to ${this.resource.filesDirectory(files)}`)
    }
  }
}
