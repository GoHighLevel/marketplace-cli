import { Flags } from '@oclif/core'

import { confirm, input, select } from '../../shared/prompts.js'
import { withSpinner } from '../../shared/spinner.js'
import {
  loadWorkflowReleaseContext,
  publishWorkflowItem,
  selectPublishCandidate,
  workflowPublishCandidates
} from '../shared/release.js'
import {
  type WorkflowResourceManifest,
  type WorkflowResourceNaming,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { workflowDirectoryFlag, WorkflowResourceCommand } from './base.js'

export function workflowPublishFlags(resource: WorkflowResourceNaming) {
  return {
    directory: workflowDirectoryFlag(),
    version: Flags.string({ description: `Draft ${resource.singular} version (defaults to the current draft)` }),
    notes: Flags.string({ description: 'Required release change log' }),
    force: Flags.boolean({ description: 'Confirm publication without prompting' })
  }
}

export interface WorkflowPublishInput {
  selector?: string
  directory: string
  version?: string
  notes?: string
  force: boolean
}

export abstract class WorkflowPublishCommand<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceCommand<M, P, W, F, S> {
  protected async publish(options: WorkflowPublishInput): Promise<unknown> {
    const { singular } = this.resource
    if ((!options.selector || !options.notes || !options.force) && !this.interactive) {
      this.error(`Pass the ${singular} key, --notes, and --force when publishing non-interactively.`)
    }
    if (options.notes !== undefined && !options.notes.trim()) this.error('--notes must contain a non-empty change log.')
    const context = await withSpinner(
      `Validating workflow ${singular}...`,
      () => loadWorkflowReleaseContext(this.resource, options.directory, { purpose: 'publish' }),
      this.spinnerOptions
    )
    const candidates = workflowPublishCandidates(this.resource, context, options.version)
    const selector =
      options.selector ??
      (await select({
        message: `Workflow ${singular} to publish:`,
        choices: candidates.map(candidate => ({
          name: `${candidate.version.info.name} (${candidate.item.key})${candidate.repairRegistry ? ' — repair registry' : ''}`,
          value: candidate.item.key
        }))
      }))
    const candidate = selectPublishCandidate(this.resource, context, candidates, selector)
    const { item, version, repairRegistry } = candidate
    const notes = (
      options.notes ??
      (await input({
        message: 'Release change log:',
        validate: value => (value.trim() ? true : 'Release change log is required.')
      }))
    ).trim()
    if (!notes) throw new Error('Release change log is required.')
    if (!options.force) {
      const approved = await confirm({
        message: repairRegistry
          ? `Repair the registry for ${item.key} version ${version.version}?`
          : `Publish ${item.key} version ${version.version}?`,
        default: false
      })
      if (!approved) {
        this.log('Cancelled — nothing was changed.')
        return
      }
    }
    const published = await withSpinner(
      `Publishing workflow ${singular}...`,
      () => publishWorkflowItem(this.resource, context, candidate, notes),
      this.spinnerOptions
    )
    const result = {
      appId: context.appId,
      key: published.key,
      version: published.version,
      status: 'published',
      repairedRegistry: repairRegistry,
      files: published.files
    }
    if (this.jsonEnabled()) return result
    this.log(
      repairRegistry
        ? `Repaired the publication registry for "${item.key}" version ${version.version}.`
        : `Published "${item.key}" version ${version.version}.`
    )
  }
}
