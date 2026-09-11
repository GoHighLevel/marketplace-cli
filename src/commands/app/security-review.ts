import { Command, Flags } from '@oclif/core'

import { ApiClient } from '../../lib/api/client.js'
import { findAppItemById, resolveAppDetails } from '../../lib/app/context.js'
import { confirm, isPromptCancel } from '../../lib/shared/prompts.js'
import { formatReadinessError, requireSecurityReviewEligible } from '../../lib/app/rules.js'
import { getConfig } from '../../lib/config/environment.js'
import { validateStoredReviewDetails } from '../../lib/app/profile-sections.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppSecurityReview extends Command {
  static description = 'Request a security review for the selected app'

  static examples = ['<%= config.bin %> app security-review', '<%= config.bin %> app security-review --force']

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AppSecurityReview)
    if (!flags.force && !process.stdin.isTTY) {
      this.error('Requesting security review is a submission action — pass --force when running non-interactively.')
    }
    try {
      const config = getConfig()
      const client = new ApiClient(config)
      const resolution = await withSpinner('Loading app...', async () => {
        await client.init()
        return resolveAppDetails(client, config, flags.app)
      })
      const { selected } = resolution
      const app =
        resolution.summary ??
        (await withSpinner('Checking security review eligibility...', () =>
          findAppItemById(client, selected.appId, selected.name)
        ))
      const liveVersion = await withSpinner('Loading live version...', () =>
        client.getLatestVersion(selected.appId, true)
      )
      requireSecurityReviewEligible(liveVersion, app.agencyInstallCount ?? 0)

      const validation = await withSpinner('Validating...', () =>
        client.preSubmitValidation(selected.appId, liveVersion._id)
      )
      const hasMissingFields = Object.values(validation.mandatoryFields ?? {}).some(valid => !valid)
      if (!validation.success || hasMissingFields) this.error(formatReadinessError(validation))

      const reviewDetailsValidation = validateStoredReviewDetails(liveVersion, true)
      if (reviewDetailsValidation !== true) {
        this.error(`${reviewDetailsValidation} Complete the fields with \`ghl app review-details\` first.`)
      }
      if (!flags.force) {
        const ok = await confirm({
          message: `Submit "${liveVersion.name ?? selected.appId}" for security review?`,
          default: false
        })
        if (!ok) return
      }
      await withSpinner('Requesting security review...', () => client.requestSecurityReview(selected.appId))
      this.log('Security review requested.')
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Security review request failed')
    }
  }
}
