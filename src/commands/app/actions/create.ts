import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { input } from '../../../lib/shared/prompts.js'
import { createWorkflowActionScaffold } from '../../../lib/workflows/actions/manifest.js'
import { validateWorkflowActionsManifest } from '../../../lib/workflows/actions/schema.js'
import {
  loadWorkflowActionsWorkspace,
  workflowActionFilenameFromKey,
  writeLocalWorkflowActionsManifest
} from '../../../lib/workflows/actions/workspace.js'

export default class AppActionsCreate extends GhlCommand {
  static description = 'Add a new workflow action draft as its own JSON file; run actions push to create it remotely'

  static examples = [
    '<%= config.bin %> app actions create "Send message" --key send_message',
    '<%= config.bin %> app actions create --directory ./my-app'
  ]

  static enableJsonFlag = true

  static args = {
    name: Args.string({ description: 'Action name (prompted interactively when omitted)' })
  }

  static flags = {
    key: Flags.string({ description: 'Stable action key using lowercase letters, numbers, and underscores' }),
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppActionsCreate)
    const interactive = process.stdin.isTTY === true && !this.jsonEnabled()
    if ((!args.name || !flags.key) && !interactive) {
      this.error('Pass the action name and --key when running non-interactively.')
    }
    const workspace = await loadWorkflowActionsWorkspace(flags.directory)
    const name =
      args.name ??
      (await input({
        message: 'Action name:',
        validate: value => (value.trim() ? true : 'Action name is required.')
      }))
    const key =
      flags.key ??
      (await input({
        message: 'Action key:',
        validate: value =>
          /^[a-z][_a-z0-9]*$/.test(value)
            ? true
            : 'Use lowercase letters, numbers, and underscores, starting with a letter.'
      }))
    const manifest = structuredClone(workspace.manifest)
    manifest.actions.push(createWorkflowActionScaffold(name.trim(), key.trim()))
    manifest.actions.sort((left, right) => left.key.localeCompare(right.key))
    const errors = validateWorkflowActionsManifest(manifest)
    if (errors.length > 0) throw new Error(`Workflow action is invalid:\n- ${errors.join('\n- ')}`)
    const files = await writeLocalWorkflowActionsManifest(workspace.directory, manifest)
    const actionFile = files.actionFiles.find(file => file.endsWith(workflowActionFilenameFromKey(key.trim())))
    if (!actionFile) throw new Error(`The workflow action file for "${key.trim()}" was not written.`)
    const result = { appId: manifest.appId, key: key.trim(), name: name.trim(), actionFile, staged: true }
    if (this.jsonEnabled()) return result
    this.log(`Added "${name.trim()}" to ${actionFile}. Run \`ghl app actions push\` to create it in the portal.`)
  }
}
