import { Args, Command, Flags } from '@oclif/core'

import { confirm, input, isPromptCancel, select } from '../../../lib/shared/prompts.js'
import {
  loadWorkflowTriggersSyncContext,
  workflowTriggersPlanError
} from '../../../lib/workflows/triggers/command-context.js'
import {
  fetchWorkflowTriggersManifest,
  workflowTriggerPublishCandidates
} from '../../../lib/workflows/triggers/service.js'
import { validateWorkflowTriggersManifest } from '../../../lib/workflows/triggers/schema.js'
import { writeWorkflowTriggersWorkspace } from '../../../lib/workflows/triggers/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppTriggersPublish extends Command {
  static description = 'Validate and publish a workflow trigger draft with a change log'

  static examples = [
    '<%= config.bin %> app triggers publish order_created',
    '<%= config.bin %> app triggers publish order_created --notes "Initial release" --force'
  ]

  static enableJsonFlag = true

  static args = {
    trigger: Args.string({ description: 'Trigger key or template id (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    version: Flags.string({ description: 'Draft trigger version (defaults to the current draft)' }),
    notes: Flags.string({ description: 'Required release change log' }),
    force: Flags.boolean({ description: 'Confirm publication without prompting' })
  }

  async run(): Promise<unknown> {
    const { args, flags } = await this.parse(AppTriggersPublish)
    const interactive = process.stdin.isTTY === true && !this.jsonEnabled()
    if ((!args.trigger || !flags.notes || !flags.force) && !interactive) {
      this.error('Pass the trigger key, --notes, and --force when publishing non-interactively.')
    }
    if (flags.notes !== undefined && !flags.notes.trim()) this.error('--notes must contain a non-empty change log.')
    try {
      const context = await withSpinner(
        'Validating workflow trigger...',
        () => loadWorkflowTriggersSyncContext(flags.directory, { requirePrerequisites: true }),
        { quiet: this.jsonEnabled() }
      )
      const planError = workflowTriggersPlanError(context.plan)
      if (planError) throw planError
      if (context.plan.localChanges.length > 0) {
        throw new Error('Push local workflow trigger changes before publishing: `ghl app triggers push`.')
      }
      const candidates = workflowTriggerPublishCandidates(context.remote, context.summaries, flags.version)
      if (candidates.length === 0) {
        throw new Error('No workflow trigger has a matching draft or incomplete registry publication.')
      }
      const selector = args.trigger ?? await select({
        message: 'Workflow trigger to publish:',
        choices: candidates.map(candidate => ({
          name: `${candidate.version.info.name ?? candidate.trigger.key} (${candidate.trigger.key})${candidate.repairRegistry ? ' — repair registry' : ''}`,
          value: candidate.trigger.key
        }))
      })
      const candidate = candidates.find(item => item.trigger.key === selector || item.trigger.templateId === selector)
      if (!candidate?.trigger.templateId) throw new Error(`Workflow trigger "${selector}" has no publishable version.`)
      const { trigger, version, repairRegistry } = candidate
      if (!repairRegistry) {
        const errors = validateWorkflowTriggersManifest(context.remote, {
          publishable: true,
          triggerKey: trigger.key,
          version: version.version
        })
        if (errors.length > 0) throw new Error(`Workflow trigger cannot be published:\n- ${errors.join('\n- ')}`)
      }
      const notes = flags.notes ?? await input({
        message: 'Release change log:',
        validate: value => value.trim() ? true : 'Release change log is required.'
      })
      if (!flags.force) {
        const approved = await confirm({
          message: repairRegistry
            ? `Repair the registry for ${trigger.key} version ${version.version}?`
            : `Publish ${trigger.key} version ${version.version}?`,
          default: false
        })
        if (!approved) {
          this.log('Cancelled — nothing was changed.')
          return
        }
      }
      await withSpinner(
        'Publishing workflow trigger...',
        async () => {
          if (!repairRegistry) {
            await context.client.submitWorkflowTriggerForReview(context.appId, {
              id: trigger.templateId as string,
              type: 'Trigger',
              version: version.version,
              releaseNotes: { user: notes.trim(), reviewer: notes.trim() }
            })
          }
          await context.client.publishWorkflowTriggerSummary(context.appId, trigger.templateId as string, version.version)
        },
        { quiet: this.jsonEnabled() }
      )
      const remote = await fetchWorkflowTriggersManifest(context.client, context.appId)
      const files = await writeWorkflowTriggersWorkspace(context.directory, remote)
      const result = { appId: context.appId, key: trigger.key, version: version.version, status: 'published', repairedRegistry: repairRegistry, files }
      if (this.jsonEnabled()) return result
      this.log(
        repairRegistry
          ? `Repaired the publication registry for "${trigger.key}" version ${version.version}.`
          : `Published "${trigger.key}" version ${version.version}.`
      )
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to publish the workflow trigger.')
    }
  }
}
