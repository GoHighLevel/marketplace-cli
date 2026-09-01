import { Command, Flags } from '@oclif/core'

import { loadWorkflowTriggersRemoteContext } from '../../../lib/workflows/triggers/command-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { renderTable } from '../../../lib/shared/table.js'

export default class AppTriggers extends Command {
  static description = 'List workflow triggers registered for an app'

  static examples = [
    '<%= config.bin %> app triggers',
    '<%= config.bin %> app triggers --app 67ee6752f753647b1c9ae06e --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the current workspace or selected app)' }),
    directory: Flags.string({ description: 'App workspace directory used to resolve the app id', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppTriggers)
    try {
      const context = await loadWorkflowTriggersRemoteContext({ appId: flags.app, directory: flags.directory })
      const triggers = await withSpinner(
        'Loading workflow triggers...',
        () => context.client.listWorkflowTriggerSummaries(context.appId),
        { quiet: this.jsonEnabled() }
      )
      if (this.jsonEnabled()) return { appId: context.appId, triggers }
      if (triggers.length === 0) {
        this.log('No workflow triggers are registered for this app.')
        return
      }
      this.log(
        renderTable(
          ['TRIGGER ID', 'NAME', 'VERSION', 'STATUS'],
          triggers.map(trigger => [trigger.triggerId, trigger.name, trigger.version, trigger.status ?? 'draft'])
        )
      )
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to list workflow triggers.')
    }
  }
}
