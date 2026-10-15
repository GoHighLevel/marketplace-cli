import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { confirm, input, select } from '../../lib/shared/prompts.js'
import { executePublish, FIRST_VERSION, preparePublish } from '../../lib/app/release.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { validateNewVersion } from '../../lib/app/versioning.js'

export default class AppPublish extends GhlCommand {
  static description = 'Publish the draft version (private apps go live; public apps enter marketplace review)'

  static examples = [
    '<%= config.bin %> app publish',
    '<%= config.bin %> app publish --version 1.1.0 --agency-notes "Adds calendar sync"',
    '<%= config.bin %> app publish --version 1.1.0 --agency-notes "Adds calendar sync" --force --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    version: Flags.string({ description: 'New semver version — must be a patch/minor/major bump of the live version' }),
    'agency-notes': Flags.string({ description: 'Release notes shown to agencies' }),
    'sub-account-notes': Flags.string({ description: 'Release notes shown to sub-accounts' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppPublish)
    const json = this.jsonEnabled()
    const interactive = process.stdin.isTTY === true && !json

    if (!flags.force && !interactive) {
      this.error(
        'Publishing changes app availability or submits a review — pass --force when running non-interactively.'
      )
    }

    const target = await loadAppContext(flags.app, json)
    const preparation = await withSpinner('Validating...', () => preparePublish(target), { quiet: json })
    const { isPrivate, baseVersion, options } = preparation

    let newVersion: string
    let agencyNotes = flags['agency-notes']
    let subAccountNotes = flags['sub-account-notes']

    if (baseVersion === undefined) {
      /* First publish: the portal skips the version and notes steps and
         publishes 1.0.0 with empty notes. */
      if (flags.version !== undefined && flags.version !== FIRST_VERSION) {
        this.error('The first published version is always 1.0.0 — drop --version or pass 1.0.0.')
      }
      newVersion = FIRST_VERSION
      agencyNotes ??= ''
      subAccountNotes ??= ''
    } else {
      if (flags.version !== undefined) {
        const check = validateNewVersion(flags.version, options)
        if (check !== true) this.error(check)
        newVersion = flags.version
      } else {
        if (!interactive) {
          this.error(
            'Pass --version and --agency-notes when running non-interactively, e.g. `ghl app publish --version 1.1.0 --agency-notes "..."`.'
          )
        }
        newVersion = await select({
          message: `New version (current: ${baseVersion}):`,
          choices: options.map(option => ({
            name: `${option.version} (${option.type})${option.disabledReason ? ` — ${option.disabledReason}` : ''}`,
            value: option.version,
            disabled: Boolean(option.disabledReason)
          })),
          default: preparation.suggestedVersion
        })
      }

      if (agencyNotes === undefined) {
        if (!interactive) {
          this.error('Pass --agency-notes when running non-interactively.')
        }
        agencyNotes = await input({
          message: 'Release notes for agencies:',
          validate: value => (value.trim() ? true : 'Release notes are required.')
        })
      }
      if (!agencyNotes.trim()) this.error('--agency-notes cannot be blank.')

      if (subAccountNotes === undefined && interactive && flags['agency-notes'] === undefined) {
        const differs = await confirm({ message: 'Show different notes to sub-accounts?', default: false })
        if (differs) {
          subAccountNotes = await input({
            message: 'Release notes for sub-accounts:',
            validate: value => (value.trim() ? true : 'Release notes are required.')
          })
        }
      }
      if (subAccountNotes !== undefined && !subAccountNotes.trim() && baseVersion !== undefined) {
        this.error('--sub-account-notes cannot be blank when provided.')
      }
    }

    if (!flags.force) {
      const ok = await confirm({
        message: isPrivate
          ? `Publish ${newVersion}? The version goes live immediately for new installs.`
          : `Submit ${newVersion} for marketplace review?`,
        default: false
      })
      if (!ok) return
    }

    const request = { newVersion, agencyNotes: agencyNotes ?? '', subAccountNotes: subAccountNotes ?? '' }
    await withSpinner(
      isPrivate ? 'Publishing version...' : 'Submitting for review...',
      () => executePublish(target, preparation, request, process.cwd()),
      { quiet: json }
    )

    if (json) {
      const { appId, versionId } = target.selected
      return { appId, versionId, version: newVersion, status: isPrivate ? 'live' : 'review' }
    }
    this.log(
      isPrivate
        ? `Version ${newVersion} is live.`
        : `Version ${newVersion} submitted for review. Track it with \`ghl app versions\`.`
    )
  }
}
