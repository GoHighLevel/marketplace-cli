import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { readPullWorkspaceBinding } from '../../../lib/app/pull.js'
import { loadWorkflowTriggersRemoteContext } from '../../../lib/workflows/triggers/command-context.js'
import { fetchWorkflowTriggersManifest } from '../../../lib/workflows/triggers/service.js'
import { writeWorkflowTriggersWorkspace } from '../../../lib/workflows/triggers/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppTriggersPull extends GhlCommand {
  static description = 'Pull every workflow trigger into local JSON files'

  static examples = [
    '<%= config.bin %> app triggers pull',
    '<%= config.bin %> app triggers pull --directory ./my-app --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id; must match the workspace app' }),
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppTriggersPull)
    const binding = await readPullWorkspaceBinding(flags.directory)
    if (!binding)
      throw new Error('No ghl-app.json was found. Run this command inside an app workspace or pass --directory.')
    const context = await loadWorkflowTriggersRemoteContext({
      appId: flags.app,
      directory: binding.directory,
      requireWorkspaceMatch: true
    })
    const manifest = await withSpinner(
      'Pulling workflow triggers...',
      () => fetchWorkflowTriggersManifest(context.client, context.appId),
      { quiet: this.jsonEnabled() }
    )
    const files = await writeWorkflowTriggersWorkspace(binding.directory, manifest)
    if (this.jsonEnabled()) {
      return {
        appId: context.appId,
        triggers: manifest.triggers.length,
        files: manifest.triggers.length > 0 ? files : { triggerStateFile: files.triggerStateFile }
      }
    }
    if (manifest.triggers.length === 0) {
      this.log('Pulled 0 workflow triggers. No trigger directory was created.')
    } else {
      this.log(`Pulled ${manifest.triggers.length} workflow trigger(s) to ${files.triggerDirectory}`)
    }
  }
}
