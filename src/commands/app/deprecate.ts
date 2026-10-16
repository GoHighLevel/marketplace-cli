import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { confirm, input } from '../../lib/shared/prompts.js'
import { executeDeprecation, localTimezone, prepareDeprecation, validateTimezone } from '../../lib/app/release.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { validateDeprecationDate } from '../../lib/shared/validation.js'

export default class AppDeprecate extends GhlCommand {
  static description = 'Schedule deprecation of the selected version'

  static examples = [
    '<%= config.bin %> app deprecate',
    '<%= config.bin %> app deprecate --date 2026-12-31 --reason "Superseded by v2"',
    '<%= config.bin %> app deprecate --date 2026-12-31 --reason "Superseded by v2" --force --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    date: Flags.string({ description: 'Deprecation date (YYYY-MM-DD, at least 3 days from today)' }),
    timezone: Flags.string({ description: 'IANA timezone (defaults to your local timezone), e.g. America/New_York' }),
    reason: Flags.string({ description: 'Deprecation notes shown to installed users' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppDeprecate)
    const json = this.jsonEnabled()
    const interactive = process.stdin.isTTY === true && !json

    if ((flags.date === undefined || flags.reason === undefined) && !interactive) {
      this.error(
        'Pass --date and --reason when running non-interactively, e.g. `ghl app deprecate --date 2026-12-31 --reason "Superseded by v2"`.'
      )
    }

    const timezone = flags.timezone ?? localTimezone()
    const timezoneValidation = validateTimezone(timezone)
    if (timezoneValidation !== true) this.error(timezoneValidation)

    const context = await loadAppContext(flags.app, json)
    await withSpinner('Checking versions...', () => prepareDeprecation(context), { quiet: json })

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
    await withSpinner(
      'Scheduling deprecation...',
      () => executeDeprecation(context, { date, timezone, notes: reason }),
      { quiet: json }
    )
    if (json) {
      const { appId, versionId } = context.selected
      return { appId, versionId, deprecateDate: date, timezone }
    }
    this.log(`Deprecation scheduled for ${date}.`)
  }
}
