import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { confirm, select } from '../../../lib/shared/prompts.js'
import {
  loadWorkflowActionsWorkspace,
  writeLocalWorkflowActionsManifest
} from '../../../lib/workflows/actions/workspace.js'

export default class AppActionsDelete extends GhlCommand {
  static description = 'Remove a local workflow action file; run actions push to delete the remote action'

  static enableJsonFlag = true

  static examples = [
    '<%= config.bin %> app actions delete send_message',
    '<%= config.bin %> app actions delete send_message --force'
  ]

  static args = {
    action: Args.string({ description: 'Action key or template id (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    force: Flags.boolean({ description: 'Confirm the local removal without prompting' })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppActionsDelete)
    if (!args.action && (!process.stdin.isTTY || this.jsonEnabled())) {
      this.error('Pass an action key and --force when running non-interactively.')
    }
    const workspace = await loadWorkflowActionsWorkspace(flags.directory)
    if (workspace.manifest.actions.length === 0) throw new Error('This app has no workflow actions to delete.')
    const selector =
      args.action ??
      (await select({
        message: 'Workflow action to remove:',
        choices: workspace.manifest.actions.map(action => ({
          name: `${action.versions[0]?.info.name ?? action.key} (${action.key})`,
          value: action.key
        }))
      }))
    const index = workspace.manifest.actions.findIndex(
      action => action.key === selector || action.templateId === selector
    )
    if (index < 0) throw new Error(`Workflow action "${selector}" was not found in local JSON.`)
    const action = workspace.manifest.actions[index]
    if (!flags.force) {
      if (!process.stdin.isTTY || this.jsonEnabled()) {
        throw new Error('Pass --force to remove a workflow action non-interactively.')
      }
      const approved = await confirm({
        message: `Remove "${action.versions[0]?.info.name ?? action.key}" from local JSON?`,
        default: false
      })
      if (!approved) {
        this.log('Cancelled — nothing was changed.')
        return
      }
    }
    const manifest = structuredClone(workspace.manifest)
    manifest.actions.splice(index, 1)
    const files = await writeLocalWorkflowActionsManifest(workspace.directory, manifest)
    const result = {
      appId: manifest.appId,
      key: action.key,
      actionDirectory: files.actionDirectory,
      stagedDeletion: true
    }
    if (this.jsonEnabled()) return result
    this.log(
      `Removed "${action.key}" from ${files.actionDirectory}. Run \`ghl app actions push --force\` to apply the deletion.`
    )
  }
}
