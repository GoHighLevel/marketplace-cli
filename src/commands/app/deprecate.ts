import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { confirm, input } from '../../lib/shared/prompts.js'
import { requireVersionStatus } from '../../lib/app/rules.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { validateDeprecationDate } from '../../lib/shared/validation.js'
import { requireDeprecatable } from '../../lib/app/versioning.js'

export default class AppDeprecate extends GhlCommand {
  static description = 'Schedule deprecation of the selected version'

  static examples = [
    '<%= config.bin %> app deprecate',
    '<%= config.bin %> app deprecate --date 2026-12-31 --reason "Superseded by v2"'
  ]

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    date: Flags.string({ description: 'Deprecation date (YYYY-MM-DD, at least 3 days from today)' }),
    timezone: Flags.string({ description: 'IANA timezone (defaults to your local timezone), e.g. America/New_York' }),
    reason: Flags.string({ description: 'Deprecation notes shown to installed users' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  protected async execute(): Promise<void> {
    const { flags } = await this.parse(AppDeprecate)
    const interactive = process.stdin.isTTY

    if ((flags.date === undefined || flags.reason === undefined) && !interactive) {
      this.error(
        'Pass --date and --reason when running non-interactively, e.g. `ghl app deprecate --date 2026-12-31 --reason "Superseded by v2"`.'
      )
    }

    /* The portal never asks for a timezone — it sends the local one. */
    const timezone = flags.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    } catch {
      this.error(`"${timezone}" is not a valid IANA timezone.`)
    }

    const context = await loadAppContext(flags.app)
    requireVersionStatus(context.version.status, ['live'], 'schedule deprecation for')

    /* Same gating as the portal's Deprecate action: keep the newest live
       version, keep at least one live version, respect the active cap. */
    const versions = await withSpinner('Checking versions...', () =>
      context.client.listVersions(context.selected.appId)
    )
    requireDeprecatable(versions, context.selected.versionId)

    const date =
      flags.date ??
      (await input({
        message: 'Deprecation date (YYYY-MM-DD, at least 3 days from today):',
        validate: value => validateDeprecationDate(value)
      }))
    const dateValidation = validateDeprecationDate(date)
    if (dateValidation !== true) this.error(dateValidation)

    const reason =
      flags.reason ??
      (await input({
        message: 'Deprecation notes shown to installed users:',
        validate: value => (value.trim() ? true : 'Deprecation notes cannot be empty.')
      }))
    if (!reason.trim()) this.error('--reason cannot be blank.')

    if (!flags.force) {
      if (!interactive) {
        this.error('Deprecation affects installed users — pass --force when running non-interactively.')
      }
      const ok = await confirm({ message: `Schedule deprecation for ${date} (${timezone})?`, default: false })
      if (!ok) return
    }
    await withSpinner('Scheduling deprecation...', () =>
      context.client.scheduleDeprecation(context.selected.appId, context.selected.versionId, {
        deprecateDate: date,
        timezone,
        deprecationNotes: reason
      })
    )
    this.log(`Deprecation scheduled for ${date}.`)
  }
}
