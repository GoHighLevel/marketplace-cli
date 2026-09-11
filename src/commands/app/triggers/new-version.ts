import { Args, Command, Flags } from '@oclif/core'

import { isPromptCancel, select } from '../../../lib/shared/prompts.js'
import {
  loadWorkflowTriggersSyncContext,
  workflowTriggersPlanError
} from '../../../lib/workflows/triggers/command-context.js'
import { fetchWorkflowTriggersManifest } from '../../../lib/workflows/triggers/service.js'
import { writeWorkflowTriggersWorkspace } from '../../../lib/workflows/triggers/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppTriggersNewVersion extends Command {
  static description = 'Create a new editable draft version from a published workflow trigger'

  static examples = ['<%= config.bin %> app triggers new-version order_created']

  static enableJsonFlag = true

  static args = {
    trigger: Args.string({ description: 'Trigger key or template id (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { args, flags } = await this.parse(AppTriggersNewVersion)
    if (!args.trigger && (!process.stdin.isTTY || this.jsonEnabled())) {
      this.error('Pass the trigger key when running non-interactively.')
    }
    try {
      const context = await withSpinner(
        'Checking workflow trigger versions...',
        () => loadWorkflowTriggersSyncContext(flags.directory),
        { quiet: this.jsonEnabled() }
      )
      const planError = workflowTriggersPlanError(context.plan)
      if (planError) throw planError
      if (context.plan.localChanges.length > 0) {
        throw new Error('Push or discard local workflow trigger changes before creating a new version.')
      }
      const eligible = context.remote.triggers.filter(
        trigger =>
          !trigger.versions.some(version => version.status === 'draft') && trigger.versions[0]?.status === 'published'
      )
      const selector =
        args.trigger ??
        (await select({
          message: 'Published workflow trigger:',
          choices: eligible.map(trigger => ({
            name: `${trigger.versions[0]?.info.name ?? trigger.key} (${trigger.key})`,
            value: trigger.key
          }))
        }))
      const trigger = context.remote.triggers.find(
        candidate => candidate.key === selector || candidate.templateId === selector
      )
      if (!trigger?.templateId) throw new Error(`Workflow trigger "${selector}" was not found.`)
      if (trigger.versions.some(version => version.status === 'draft')) {
        throw new Error(`Workflow trigger "${trigger.key}" already has an editable draft.`)
      }
      if (!trigger.versions.some(version => version.status === 'published')) {
        throw new Error(`Workflow trigger "${trigger.key}" has no published version to copy.`)
      }
      const created = await withSpinner(
        'Creating workflow trigger version...',
        () => context.client.createWorkflowTriggerVersion(context.appId, trigger.templateId as string),
        { quiet: this.jsonEnabled() }
      )
      const remote = await fetchWorkflowTriggersManifest(context.client, context.appId)
      const files = await writeWorkflowTriggersWorkspace(context.directory, remote)
      const result = { appId: context.appId, key: trigger.key, version: created.version, files }
      if (this.jsonEnabled()) return result
      this.log(`Created draft ${created.version} for "${trigger.key}" and refreshed ${files.triggerDirectory}.`)
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to create a workflow trigger version.')
    }
  }
}
