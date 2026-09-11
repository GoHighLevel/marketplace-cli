import { Flags } from '@oclif/core'

import { errorMessage } from '../../shared/errors.js'
import { confirm, input, select } from '../../shared/prompts.js'
import { withSpinner } from '../../shared/spinner.js'
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
    const { singular, plural, label } = this.resource
    if ((!options.selector || !options.notes || !options.force) && !this.interactive) {
      this.error(`Pass the ${singular} key, --notes, and --force when publishing non-interactively.`)
    }
    if (options.notes !== undefined && !options.notes.trim()) this.error('--notes must contain a non-empty change log.')
    const context = await withSpinner(
      `Validating workflow ${singular}...`,
      () => this.loadSyncContext(options.directory, { requirePrerequisites: true }),
      this.spinnerOptions
    )
    const planError = this.planError(context.plan)
    if (planError) throw planError
    if (context.plan.localChanges.length > 0) {
      throw new Error(`Push local workflow ${singular} changes before publishing: \`ghl app ${plural} push\`.`)
    }
    const candidates = this.resource.publishCandidates(context.remote, context.summaries, options.version)
    if (candidates.length === 0) {
      throw new Error(`No workflow ${singular} has a matching draft or incomplete registry publication.`)
    }
    const selector =
      options.selector ??
      (await select({
        message: `Workflow ${singular} to publish:`,
        choices: candidates.map(candidate => ({
          name: `${candidate.version.info.name} (${candidate.item.key})${candidate.repairRegistry ? ' — repair registry' : ''}`,
          value: candidate.item.key
        }))
      }))
    const candidate = candidates.find(entry => entry.item.key === selector || entry.item.templateId === selector)
    const templateId = candidate?.item.templateId
    if (!candidate || !templateId) throw new Error(`Workflow ${singular} "${selector}" has no publishable version.`)
    const { item, version, repairRegistry } = candidate
    if (!repairRegistry) {
      const errors = this.resource.validateManifest(context.remote, {
        publishable: true,
        key: item.key,
        version: version.version
      })
      if (errors.length > 0) throw new Error(`${label} cannot be published:\n- ${errors.join('\n- ')}`)
    }
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
    await withSpinner(
      `Publishing workflow ${singular}...`,
      async () => {
        if (!repairRegistry) {
          await this.resource.submitForReview(context.client, context.appId, templateId, version.version, notes)
        }
        try {
          await this.resource.publishSummary(context.client, context.appId, templateId, version.version)
        } catch (error) {
          if (repairRegistry) throw error
          throw new Error(
            `The workflow version was published, but its registry update failed: ${errorMessage(error, 'registry update failed')} ` +
              `Re-run this command with the same ${singular} and version to repair the registry.`
          )
        }
      },
      this.spinnerOptions
    )
    const remote = await this.fetchManifest(context.client, context.appId)
    const files = await this.resource.writeWorkspace(context.directory, remote)
    const result = {
      appId: context.appId,
      key: item.key,
      version: version.version,
      status: 'published',
      repairedRegistry: repairRegistry,
      files
    }
    if (this.jsonEnabled()) return result
    this.log(
      repairRegistry
        ? `Repaired the publication registry for "${item.key}" version ${version.version}.`
        : `Published "${item.key}" version ${version.version}.`
    )
  }
}
