import { Command, Flags } from '@oclif/core'

import { confirm, input, isPromptCancel, select } from '../../lib/shared/prompts.js'
import { persistSelection } from '../../lib/app/context.js'
import { formatReadinessError, requireVersionStatus, requiresPublicReviewDetails } from '../../lib/app/rules.js'
import { validateStoredReviewDetails } from '../../lib/app/profile-sections.js'
import { refreshAppWorkspaceLifecycle } from '../../lib/app/lifecycle.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import {
  MAX_PENDING_VERSIONS,
  activeVersionCount,
  baseVersionFromList,
  bumpOptions,
  minimumBumpFromAnalysis,
  pendingVersions,
  validateNewVersion
} from '../../lib/app/versioning.js'

export default class AppPublish extends Command {
  static description = 'Publish the draft version (private apps go live; public apps enter marketplace review)'

  static examples = [
    '<%= config.bin %> app publish',
    '<%= config.bin %> app publish --version 1.1.0 --agency-notes "Adds calendar sync"'
  ]

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    version: Flags.string({ description: 'New semver version — must be a patch/minor/major bump of the live version' }),
    'agency-notes': Flags.string({ description: 'Release notes shown to agencies' }),
    'sub-account-notes': Flags.string({ description: 'Release notes shown to sub-accounts' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AppPublish)
    const interactive = process.stdin.isTTY

    if (!flags.force && !interactive) {
      this.error('Publishing changes app availability or submits a review — pass --force when running non-interactively.')
    }

    try {
      const context = await loadAppContext(flags.app)
      requireVersionStatus(context.version.status, ['draft', 'disapproved'], 'publish')

      /* Fail early with the readiness checklist instead of a raw publish 400. */
      const validation = await withSpinner('Validating...', () =>
        context.client.preSubmitValidation(context.selected.appId, context.selected.versionId)
      )
      const missing = Object.entries(validation.mandatoryFields ?? {}).filter(([, ok]) => !ok)
      if (!validation.success || missing.length > 0) {
        this.error(formatReadinessError(validation))
      }

      const isPrivate = context.version.private === true

      /* Public review submissions are rejected without the App Review Details
         the portal collects in its modal — fail early with the fix. */
      if (requiresPublicReviewDetails(context.version)) {
        const reviewDetailsValidation = validateStoredReviewDetails(context.version, false)
        if (reviewDetailsValidation !== true) {
          this.error(`${reviewDetailsValidation} Complete the fields with \`ghl app review-details\` first.`)
        }
      }

      const versions = await withSpinner('Checking versions...', () =>
        context.client.listVersions(context.selected.appId)
      )

      /* The portal allows one pending (in-review) version at a time. */
      const pending = pendingVersions(versions, context.selected.versionId)
      if (pending.length >= MAX_PENDING_VERSIONS) {
        this.error(
          `Version ${pending[0].version ?? pending[0]._id} is already pending — finish or withdraw it before publishing another version.`
        )
      }

      const baseVersion = baseVersionFromList(versions)

      let newVersion: string
      let agencyNotes = flags['agency-notes']
      let subAccountNotes = flags['sub-account-notes']

      if (baseVersion === undefined) {
        /* First publish: the portal skips the version and notes steps and
           publishes 1.0.0 with empty notes. */
        if (flags.version !== undefined && flags.version !== '1.0.0') {
          this.error('The first published version is always 1.0.0 — drop --version or pass 1.0.0.')
        }
        newVersion = '1.0.0'
        agencyNotes ??= ''
        subAccountNotes ??= ''
      } else {
        const analysis = await withSpinner('Analyzing changes...', () =>
          context.client.analyzeVersion(context.selected.appId, context.selected.versionId)
        )
        const options = bumpOptions({
          baseVersion,
          minimumBump: minimumBumpFromAnalysis(analysis),
          activeVersionCount: activeVersionCount(versions)
        })
        if (options.every(option => option.disabledReason)) {
          this.error(`No version bump is currently allowed: ${options.map(option => option.disabledReason)[0]}.`)
        }

        if (flags.version !== undefined) {
          const check = validateNewVersion(flags.version, options)
          if (check !== true) this.error(check)
          newVersion = flags.version
        } else {
          if (!interactive) {
            this.error('Pass --version and --agency-notes when running non-interactively, e.g. `ghl app publish --version 1.1.0 --agency-notes "..."`.')
          }
          newVersion = await select({
            message: `New version (current: ${baseVersion}):`,
            choices: options.map(option => ({
              name: `${option.version} (${option.type})${option.disabledReason ? ` — ${option.disabledReason}` : ''}`,
              value: option.version,
              disabled: Boolean(option.disabledReason)
            })),
            default: analysis.suggestedVersion
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

      await withSpinner(isPrivate ? 'Publishing version...' : 'Submitting for review...', () =>
        context.client.publishVersion(context.selected.appId, context.selected.versionId, {
          newVersion,
          agencyNotes: agencyNotes ?? '',
          subAccountNotes: subAccountNotes ?? ''
        })
      )

      try {
        const refreshed = await withSpinner('Refreshing local status...', () =>
          refreshAppWorkspaceLifecycle(
            process.cwd(),
            context.client,
            context.selected.appId,
            context.selected.versionId,
            newVersion
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
        const outcome = isPrivate
          ? `Version ${newVersion} was published`
          : `Version ${newVersion} was submitted for review`
        const reason = error instanceof Error ? error.message : 'local synchronization failed'
        throw new Error(
          `${outcome}, but the local workspace status could not be synchronized: ${reason} ` +
            'Run `ghl app pull` before making more local changes.'
        )
      }

      this.log(
        isPrivate
          ? `Version ${newVersion} is live.`
          : `Version ${newVersion} submitted for review. Track it with \`ghl app versions\`.`
      )
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Publish failed')
    }
  }
}
