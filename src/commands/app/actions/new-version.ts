import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { select } from '../../../lib/shared/prompts.js'
import {
  loadWorkflowActionsSyncContext,
  workflowActionsPlanError
} from '../../../lib/workflows/actions/command-context.js'
import { fetchWorkflowActionsManifest } from '../../../lib/workflows/actions/service.js'
import { writeWorkflowActionsWorkspace } from '../../../lib/workflows/actions/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppActionsNewVersion extends GhlCommand {
  static description = 'Create a new editable draft version from a published workflow action'

  static examples = ['<%= config.bin %> app actions new-version send_message']

  static enableJsonFlag = true

  static args = {
    action: Args.string({ description: 'Action key or template id (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppActionsNewVersion)
    if (!args.action && (!process.stdin.isTTY || this.jsonEnabled())) {
      this.error('Pass the action key when running non-interactively.')
    }
    const context = await withSpinner(
      'Checking workflow action versions...',
      () => loadWorkflowActionsSyncContext(flags.directory),
      { quiet: this.jsonEnabled() }
    )
    const planError = workflowActionsPlanError(context.plan)
    if (planError) throw planError
    if (context.plan.localChanges.length > 0) {
      throw new Error('Push or discard local workflow action changes before creating a new version.')
    }
    const eligible = context.remote.actions.filter(
      action =>
        !action.versions.some(version => version.status === 'draft') && action.versions[0]?.status === 'published'
    )
    if (!args.action && eligible.length === 0) {
      throw new Error('No published workflow action is eligible for a new version.')
    }
    const selector =
      args.action ??
      (await select({
        message: 'Published workflow action:',
        choices: eligible.map(action => ({
          name: `${action.versions[0]?.info.name ?? action.key} (${action.key})`,
          value: action.key
        }))
      }))
    const action = context.remote.actions.find(
      candidate => candidate.key === selector || candidate.templateId === selector
    )
    if (!action?.templateId) throw new Error(`Workflow action "${selector}" was not found.`)
    if (action.versions.some(version => version.status === 'draft')) {
      throw new Error(`Workflow action "${action.key}" already has a draft version.`)
    }
    if (action.versions[0]?.status !== 'published') {
      throw new Error(
        `Workflow action "${action.key}" must have a latest published version before creating a new draft.`
      )
    }
    const created = await withSpinner(
      'Creating workflow action version...',
      () => context.client.createWorkflowActionVersion(context.appId, action.templateId as string),
      { quiet: this.jsonEnabled() }
    )
    const remote = await fetchWorkflowActionsManifest(context.client, context.appId)
    const files = await writeWorkflowActionsWorkspace(context.directory, remote)
    const result = { appId: context.appId, key: action.key, version: created.version, files }
    if (this.jsonEnabled()) return result
    this.log(`Created draft ${created.version} for "${action.key}" and refreshed ${files.actionDirectory}.`)
  }
}
