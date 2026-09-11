import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { input } from '../../../lib/shared/prompts.js'
import { createWorkflowTriggerScaffold } from '../../../lib/workflows/triggers/manifest.js'
import { validateWorkflowTriggersManifest } from '../../../lib/workflows/triggers/schema.js'
import {
  loadWorkflowTriggersWorkspace,
  workflowTriggerFilenameFromKey,
  writeWorkflowTriggersWorkspace
} from '../../../lib/workflows/triggers/workspace.js'

export default class AppTriggersCreate extends GhlCommand {
  static description = 'Add a new workflow trigger draft as its own JSON file; run triggers push to create it remotely'

  static examples = [
    '<%= config.bin %> app triggers create "Order created" --key order_created',
    '<%= config.bin %> app triggers create --directory ./my-app'
  ]

  static enableJsonFlag = true

  static args = {
    name: Args.string({ description: 'Trigger name (prompted interactively when omitted)' })
  }

  static flags = {
    key: Flags.string({ description: 'Stable trigger key using lowercase letters, numbers, and underscores' }),
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppTriggersCreate)
    const interactive = process.stdin.isTTY === true && !this.jsonEnabled()
    if ((!args.name || !flags.key) && !interactive) {
      this.error('Pass the trigger name and --key when running non-interactively.')
    }
    const workspace = await loadWorkflowTriggersWorkspace(flags.directory)
    const name =
      args.name ??
      (await input({
        message: 'Trigger name:',
        validate: value => (value.trim() ? true : 'Trigger name is required.')
      }))
    const key =
      flags.key ??
      (await input({
        message: 'Trigger key:',
        validate: value =>
          /^[a-z][_a-z0-9]*$/.test(value)
            ? true
            : 'Use lowercase letters, numbers, and underscores, starting with a letter.'
      }))
    const manifest = structuredClone(workspace.manifest)
    manifest.triggers.push(createWorkflowTriggerScaffold(name.trim(), key.trim()))
    manifest.triggers.sort((left, right) => left.key.localeCompare(right.key))
    const errors = validateWorkflowTriggersManifest(manifest)
    if (errors.length > 0) throw new Error(`Workflow trigger is invalid:\n- ${errors.join('\n- ')}`)
    const files = await writeWorkflowTriggersWorkspace(workspace.directory, manifest, workspace.state.baseline)
    const triggerFile = files.triggerFiles.find(file => file.endsWith(workflowTriggerFilenameFromKey(key.trim())))
    if (!triggerFile) throw new Error(`The workflow trigger file for "${key.trim()}" was not written.`)
    const result = { appId: manifest.appId, key: key.trim(), name: name.trim(), triggerFile, staged: true }
    if (this.jsonEnabled()) return result
    this.log(`Added "${name.trim()}" to ${triggerFile}. Run \`ghl app triggers push\` to create it in the portal.`)
  }
}
