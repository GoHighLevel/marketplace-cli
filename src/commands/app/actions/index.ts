import { Command, Flags } from '@oclif/core'

import { loadWorkflowActionsRemoteContext } from '../../../lib/workflows/actions/command-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { renderTable } from '../../../lib/shared/table.js'

export default class AppActions extends Command {
  static description = 'List workflow actions registered for an app'

  static examples = [
    '<%= config.bin %> app actions',
    '<%= config.bin %> app actions --app 67ee6752f753647b1c9ae06e --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the current workspace or selected app)' }),
    directory: Flags.string({ description: 'App workspace directory used to resolve the app id', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppActions)
    try {
      const context = await loadWorkflowActionsRemoteContext({ appId: flags.app, directory: flags.directory })
      const actions = await withSpinner(
        'Loading workflow actions...',
        () => context.client.listWorkflowActionSummaries(context.appId),
        { quiet: this.jsonEnabled() }
      )
      if (this.jsonEnabled()) return { appId: context.appId, actions }
      if (actions.length === 0) {
        this.log('No workflow actions are registered for this app.')
        return
      }
      this.log(
        renderTable(
          ['ACTION ID', 'NAME', 'VERSION', 'STATUS'],
          actions.map(action => [action.actionId, action.name, action.version, action.status])
        )
      )
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to list workflow actions.')
    }
  }
}
