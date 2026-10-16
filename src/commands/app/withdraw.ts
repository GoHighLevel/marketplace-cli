import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { confirm } from '../../lib/shared/prompts.js'
import { REVIEW_STATUSES, withdrawFromReview } from '../../lib/app/release.js'
import { requireVersionStatus } from '../../lib/app/rules.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppWithdraw extends GhlCommand {
  static description = 'Withdraw the selected version from marketplace review'

  static examples = [
    '<%= config.bin %> app withdraw',
    '<%= config.bin %> app withdraw --force',
    '<%= config.bin %> app withdraw --force --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppWithdraw)
    const json = this.jsonEnabled()
    if (!flags.force && !(process.stdin.isTTY === true && !json)) {
      this.error('Withdrawing returns the review version to draft — pass --force when running non-interactively.')
    }
    const context = await loadAppContext(flags.app, json)
    requireVersionStatus(context.version.status, REVIEW_STATUSES, 'withdraw')
    if (!flags.force) {
      const ok = await confirm({
        message: `Withdraw "${context.version.name ?? context.selected.appId}" from marketplace review?`,
        default: false
      })
      if (!ok) return
    }
    await withSpinner('Withdrawing from review...', () => withdrawFromReview(context, process.cwd()), {
      quiet: json
    })
    if (json) return { appId: context.selected.appId, versionId: context.selected.versionId, status: 'draft' }
    this.log('Version withdrawn from review — it is a draft again.')
  }
}
