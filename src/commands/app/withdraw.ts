import { Command, Flags } from '@oclif/core'

import { confirm, isPromptCancel } from '../../lib/shared/prompts.js'
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
    try {
      const context = await loadAppContext(flags.app)
      requireVersionStatus(context.version.status, ['review'], 'withdraw')
      if (!flags.force) {
        if (!process.stdin.isTTY) {
          this.error('Withdrawing returns the review version to draft — pass --force when running non-interactively.')
        }
        const ok = await confirm({
          message: `Withdraw "${context.version.name ?? context.selected.appId}" from marketplace review?`,
          default: false
        })
        if (!ok) return
      }
      await withSpinner('Withdrawing from review...', () =>
        context.client.withdrawReview(context.selected.appId, context.selected.versionId)
      )
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
