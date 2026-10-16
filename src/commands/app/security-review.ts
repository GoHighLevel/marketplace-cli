import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { ApiClient } from '../../lib/api/client.js'
import { findAppItemById, resolveAppDetails } from '../../lib/app/context.js'
import { confirm } from '../../lib/shared/prompts.js'
import { getConfig } from '../../lib/config/environment.js'
import { prepareSecurityReview } from '../../lib/app/release.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppSecurityReview extends GhlCommand {
  static description = 'Request a security review for the selected app'

  static examples = [
    '<%= config.bin %> app security-review',
    '<%= config.bin %> app security-review --force',
    '<%= config.bin %> app security-review --force --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppSecurityReview)
    const json = this.jsonEnabled()
    if (!flags.force && !(process.stdin.isTTY === true && !json)) {
      this.error('Requesting security review is a submission action — pass --force when running non-interactively.')
    }
    const config = getConfig()
    const client = new ApiClient(config)
    const resolution = await withSpinner(
      'Loading app...',
      async () => {
        await client.init()
        return resolveAppDetails(client, config, flags.app)
      },
      { quiet: json }
    )
    const { selected } = resolution
    const app =
      resolution.summary ??
      (await withSpinner(
        'Checking security review eligibility...',
        () => findAppItemById(client, selected.appId, selected.name),
        { quiet: json }
      ))
    const liveVersion = await withSpinner(
      'Checking security review eligibility...',
      () => prepareSecurityReview(client, selected.appId, app.agencyInstallCount ?? 0),
      { quiet: json }
    )
    if (!flags.force) {
      const ok = await confirm({
        message: `Submit "${liveVersion.name ?? selected.appId}" for security review?`,
        default: false
      })
      if (!ok) return
    }
    await withSpinner('Requesting security review...', () => client.requestSecurityReview(selected.appId), {
      quiet: json
    })
    if (json) return { appId: selected.appId, requested: true }
    this.log('Security review requested.')
  }
}
