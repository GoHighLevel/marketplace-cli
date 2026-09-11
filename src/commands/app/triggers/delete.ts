import { Args, Command, Flags } from '@oclif/core'

import { confirm, isPromptCancel, select } from '../../../lib/shared/prompts.js'
import {
  loadWorkflowTriggersWorkspace,
  writeWorkflowTriggersWorkspace
} from '../../../lib/workflows/triggers/workspace.js'

export default class AppTriggersDelete extends Command {
  static description = 'Remove a local workflow trigger file; run triggers push to delete the remote trigger'

  static enableJsonFlag = true

  static examples = [
    '<%= config.bin %> app triggers delete order_created',
    '<%= config.bin %> app triggers delete order_created --force'
  ]

  static args = {
    trigger: Args.string({ description: 'Trigger key or template id (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    force: Flags.boolean({ description: 'Confirm the local removal without prompting' })
  }

  async run(): Promise<unknown> {
    const { args, flags } = await this.parse(AppTriggersDelete)
    if (!args.trigger && (!process.stdin.isTTY || this.jsonEnabled())) {
      this.error('Pass a trigger key and --force when running non-interactively.')
    }
    try {
      const workspace = await loadWorkflowTriggersWorkspace(flags.directory)
      if (workspace.manifest.triggers.length === 0) throw new Error('This app has no workflow triggers to delete.')
      const selector =
        args.trigger ??
        (await select({
          message: 'Workflow trigger to remove:',
          choices: workspace.manifest.triggers.map(trigger => ({
            name: `${trigger.versions[0]?.info.name ?? trigger.key} (${trigger.key})`,
            value: trigger.key
          }))
        }))
      const index = workspace.manifest.triggers.findIndex(
        trigger => trigger.key === selector || trigger.templateId === selector
      )
      if (index < 0) throw new Error(`Workflow trigger "${selector}" was not found in local JSON.`)
      const trigger = workspace.manifest.triggers[index]
      if (!flags.force) {
        if (!process.stdin.isTTY || this.jsonEnabled()) {
          throw new Error('Pass --force to remove a workflow trigger non-interactively.')
        }
        const approved = await confirm({
          message: `Remove "${trigger.versions[0]?.info.name ?? trigger.key}" from local JSON?`,
          default: false
        })
        if (!approved) {
          this.log('Cancelled — nothing was changed.')
          return
        }
      }
      const manifest = structuredClone(workspace.manifest)
      manifest.triggers.splice(index, 1)
      const files = await writeWorkflowTriggersWorkspace(workspace.directory, manifest, workspace.state.baseline)
      const result = {
        appId: manifest.appId,
        key: trigger.key,
        triggerDirectory: files.triggerDirectory,
        stagedDeletion: true
      }
      if (this.jsonEnabled()) return result
      this.log(
        `Removed "${trigger.key}" from ${files.triggerDirectory}. Run \`ghl app triggers push --force\` to apply the deletion.`
      )
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to stage workflow trigger deletion.')
    }
  }
}
