import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { readPullWorkspaceBinding } from '../../../lib/app/pull.js'
import { loadWorkflowActionsRemoteContext } from '../../../lib/workflows/actions/command-context.js'
import { fetchWorkflowActionsManifest } from '../../../lib/workflows/actions/service.js'
import { writeWorkflowActionsWorkspace } from '../../../lib/workflows/actions/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppActionsPull extends GhlCommand {
  static description = 'Pull every workflow action into local JSON and versioned JavaScript files'

  static examples = [
    '<%= config.bin %> app actions pull',
    '<%= config.bin %> app actions pull --directory ./my-app --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id; must match the workspace app' }),
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppActionsPull)
    const binding = await readPullWorkspaceBinding(flags.directory)
    if (!binding)
      throw new Error('No ghl-app.json was found. Run this command inside an app workspace or pass --directory.')
    const context = await loadWorkflowActionsRemoteContext({
      appId: flags.app,
      directory: binding.directory,
      requireWorkspaceMatch: true
    })
    const manifest = await withSpinner(
      'Pulling workflow actions...',
      () => fetchWorkflowActionsManifest(context.client, context.appId),
      { quiet: this.jsonEnabled() }
    )
    const files = await writeWorkflowActionsWorkspace(binding.directory, manifest)
    if (this.jsonEnabled()) {
      return {
        appId: context.appId,
        actions: manifest.actions.length,
        files: manifest.actions.length > 0 ? files : { stateFile: files.stateFile }
      }
    }
    if (manifest.actions.length === 0) {
      this.log('Pulled 0 workflow actions. No action directory was created.')
    } else {
      this.log(`Pulled ${manifest.actions.length} workflow action(s) to ${files.actionDirectory}`)
    }
  }
}
