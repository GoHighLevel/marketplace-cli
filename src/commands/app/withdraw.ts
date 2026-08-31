import { Command, Flags } from '@oclif/core'

import { confirm, isPromptCancel } from '../../lib/shared/prompts.js'
import { persistSelection } from '../../lib/app/context.js'
import { refreshAppWorkspaceLifecycle } from '../../lib/app/lifecycle.js'
import { requireVersionStatus } from '../../lib/app/rules.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppWithdraw extends Command {
  static description = 'Withdraw the selected version from marketplace review'

  static examples = ['<%= config.bin %> app withdraw', '<%= config.bin %> app withdraw --force']

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AppWithdraw)
    if (!flags.force && !process.stdin.isTTY) {
      this.error('Withdrawing returns the review version to draft — pass --force when running non-interactively.')
    }
    try {
      const context = await loadAppContext(flags.app)
      requireVersionStatus(context.version.status, ['review'], 'withdraw')
      if (!flags.force) {
        const ok = await confirm({
          message: `Withdraw "${context.version.name ?? context.selected.appId}" from marketplace review?`,
          default: false
        })
        if (!ok) return
      }
      await withSpinner('Withdrawing from review...', () =>
        context.client.withdrawReview(context.selected.appId, context.selected.versionId)
      )
      try {
        const refreshed = await withSpinner('Refreshing local status...', () =>
          refreshAppWorkspaceLifecycle(
            process.cwd(),
            context.client,
            context.selected.appId,
            context.selected.versionId,
            'draft'
          )
        )
        if (refreshed && refreshed.version._id !== context.selected.versionId) {
          await persistSelection(context.client, context.config, {
            appId: context.selected.appId,
            versionId: refreshed.version._id,
            name: refreshed.version.name ?? context.selected.name
          })
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'local synchronization failed'
        throw new Error(
          `The version was withdrawn, but the local workspace status could not be synchronized: ${reason} ` +
            'Run `ghl app pull` before making more local changes.'
        )
      }
      this.log('Version withdrawn from review — it is a draft again.')
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Withdraw failed')
    }
  }
}
