import { Args, Command, Flags } from '@oclif/core'

import { confirm, input, isPromptCancel, select } from '../../../lib/shared/prompts.js'
import {
  loadWorkflowActionsSyncContext,
  workflowActionsPlanError
} from '../../../lib/workflows/actions/command-context.js'
import {
  fetchWorkflowActionsManifest,
  workflowActionPublishCandidates
} from '../../../lib/workflows/actions/service.js'
import { validateWorkflowActionVersionForPublish } from '../../../lib/workflows/actions/schema.js'
import { writeWorkflowActionsWorkspace } from '../../../lib/workflows/actions/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppActionsPublish extends Command {
  static description = 'Validate and publish a workflow action draft with a change log'

  static examples = [
    '<%= config.bin %> app actions publish send_message',
    '<%= config.bin %> app actions publish send_message --notes "Initial release" --force'
  ]

  static enableJsonFlag = true

  static args = {
    action: Args.string({ description: 'Action key or template id (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    version: Flags.string({ description: 'Draft action version (defaults to the current draft)' }),
    notes: Flags.string({ description: 'Required release change log' }),
    force: Flags.boolean({ description: 'Confirm publication without prompting' })
  }

  async run(): Promise<unknown> {
    const { args, flags } = await this.parse(AppActionsPublish)
    const interactive = process.stdin.isTTY === true && !this.jsonEnabled()
    if ((!args.action || !flags.notes || !flags.force) && !interactive) {
      this.error('Pass the action key, --notes, and --force when publishing non-interactively.')
    }
    try {
      const context = await withSpinner(
        'Validating workflow action...',
        () => loadWorkflowActionsSyncContext(flags.directory, { requirePrerequisites: true }),
        { quiet: this.jsonEnabled() }
      )
      const planError = workflowActionsPlanError(context.plan)
      if (planError) throw planError
      if (context.plan.localChanges.length > 0) {
        throw new Error('Push local workflow action changes before publishing: `ghl app actions push`.')
      }
      const candidates = workflowActionPublishCandidates(context.remote, context.summaries, flags.version)
      if (candidates.length === 0) {
        throw new Error('No workflow action has a matching draft or incomplete registry publication.')
      }
      const selector =
        args.action ??
        (await select({
          message: 'Workflow action to publish:',
          choices: candidates.map(candidate => ({
            name: `${candidate.version.info.name ?? candidate.action.key} (${candidate.action.key})${candidate.repairRegistry ? ' — repair registry' : ''}`,
            value: candidate.action.key
          }))
        }))
      const candidate = candidates.find(item => item.action.key === selector || item.action.templateId === selector)
      if (!candidate?.action.templateId) throw new Error(`Workflow action "${selector}" has no publishable version.`)
      const { action, version, repairRegistry } = candidate
      if (!repairRegistry) {
        const errors = validateWorkflowActionVersionForPublish(context.remote, action.key, version.version)
        if (errors.length > 0) throw new Error(`Workflow action cannot be published:\n- ${errors.join('\n- ')}`)
      }
      const notes =
        flags.notes ??
        (await input({
          message: 'Release change log:',
          validate: value => (value.trim() ? true : 'Release change log is required.')
        }))
      if (!notes.trim()) throw new Error('Release change log is required.')
      if (!flags.force) {
        const approved = await confirm({
          message: repairRegistry
            ? `Repair the registry for ${action.key} version ${version.version}?`
            : `Publish ${action.key} version ${version.version}?`,
          default: false
        })
        if (!approved) {
          this.log('Cancelled — nothing was changed.')
          return
        }
      }
      await withSpinner(
        'Publishing workflow action...',
        async () => {
          if (!repairRegistry) {
            await context.client.submitWorkflowActionForReview(context.appId, {
              id: action.templateId as string,
              type: 'Action',
              version: version.version,
              releaseNotes: { user: notes.trim(), reviewer: notes.trim() }
            })
          }
          try {
            await context.client.publishWorkflowActionSummary(
              context.appId,
              action.templateId as string,
              version.version
            )
          } catch (error) {
            if (repairRegistry) throw error
            const reason = error instanceof Error ? error.message : 'registry update failed'
            throw new Error(
              `The workflow version was published, but its registry update failed: ${reason} ` +
                'Re-run this command with the same action and version to repair the registry.'
            )
          }
        },
        { quiet: this.jsonEnabled() }
      )
      const remote = await fetchWorkflowActionsManifest(context.client, context.appId)
      const files = await writeWorkflowActionsWorkspace(context.directory, remote)
      const result = {
        appId: context.appId,
        key: action.key,
        version: version.version,
        status: 'published',
        repairedRegistry: repairRegistry,
        files
      }
      if (this.jsonEnabled()) return result
      this.log(
        repairRegistry
          ? `Repaired the publication registry for "${action.key}" version ${version.version}.`
          : `Published "${action.key}" version ${version.version}.`
      )
      return
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to publish the workflow action.')
    }
  }
}
