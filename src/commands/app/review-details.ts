import { Command, Flags } from '@oclif/core'

import { input, isPromptCancel } from '../../lib/shared/prompts.js'
import { AppVersion } from '../../lib/api/client.js'
import {
  buildReviewDetailsBody,
  ReviewDetailsChanges,
  validateDemoUrl,
  validateReviewDetailsBody,
  validateReviewDetailsChanges
} from '../../lib/app/profile-sections.js'
import { followVersionChange, loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppReviewDetails extends Command {
  static description = 'Edit the app-review details (demo videos, test credentials) required for review submission'

  static examples = [
    '<%= config.bin %> app review-details',
    '<%= config.bin %> app review-details --demo https://youtu.be/x --scopes-demo https://youtu.be/y'
  ]

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    demo: Flags.string({ description: 'End-to-end demo video URL (https)' }),
    'scopes-demo': Flags.string({ description: 'Demo video URL explaining why each scope is needed (https)' }),
    credentials: Flags.string({ description: 'Test credentials for the review team' }),
    notes: Flags.string({ description: 'Additional details for the review team' }),
    'private-reason': Flags.string({ description: 'Why the app stays private (private apps only)' })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AppReviewDetails)
    const changes = this.changesFromFlags(flags)
    const hasFlagChanges = Object.keys(changes).length > 0

    if (!hasFlagChanges && !process.stdin.isTTY) {
      this.error('Pass at least one field flag (--demo, --scopes-demo, ...) when running non-interactively.')
    }

    try {
      const context = await loadAppContext(flags.app)
      if (context.version.appType === 'template') {
        this.error('Template apps do not use app-review details; the developer portal skips this step.')
      }
      if (flags['private-reason'] !== undefined && context.version.private !== true) {
        this.error('--private-reason only applies to private apps.')
      }
      const finalChanges = hasFlagChanges ? changes : await this.promptChanges(context.version)

      for (const url of [finalChanges.demoUrl, finalChanges.scopesDemoUrl]) {
        if (url !== undefined) {
          const valid = validateDemoUrl(url)
          if (valid !== true) this.error(valid)
        }
      }
      const changesValidation = validateReviewDetailsChanges(finalChanges)
      if (changesValidation !== true) this.error(changesValidation)

      const body = buildReviewDetailsBody(context.version, finalChanges)
      const validation = validateReviewDetailsBody(body, context.version.private === true)
      if (validation !== true) this.error(validation)
      const result = await withSpinner('Saving review details...', () =>
        context.client.updateReviewDetails(context.selected.appId, context.selected.versionId, body)
      )
      this.log('Review details updated.')
      await followVersionChange(context, result, message => this.log(message))
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to update review details')
    }
  }

  private changesFromFlags(flags: Record<string, string | undefined>): ReviewDetailsChanges {
    const changes: ReviewDetailsChanges = {}
    if (flags.demo !== undefined) changes.demoUrl = flags.demo
    if (flags['scopes-demo'] !== undefined) changes.scopesDemoUrl = flags['scopes-demo']
    if (flags.credentials !== undefined) changes.testCredentials = flags.credentials
    if (flags.notes !== undefined) changes.notes = flags.notes
    if (flags['private-reason'] !== undefined) changes.privateReason = flags['private-reason']
    return changes
  }

  private async promptChanges(version: AppVersion): Promise<ReviewDetailsChanges> {
    const demoUrl = await input({
      message: 'End-to-end demo video URL (https):',
      default: version.endToEndDemoUrl ?? '',
      validate: validateDemoUrl
    })
    const scopesDemoUrl = await input({
      message: 'Scopes demo video URL — why each scope is needed (https):',
      default: version.scopesDemoUrl ?? '',
      validate: validateDemoUrl
    })
    const testCredentials = await input({
      message: 'Test credentials for the review team:',
      default: version.testCredentials ?? '',
      validate: value => value.length <= 200 ? true : 'Test credentials must be at most 200 characters.'
    })
    const notes = await input({
      message: 'Additional details (optional):',
      default: version.additionalDetails ?? '',
      validate: value => value.length <= 500 ? true : 'Additional details must be at most 500 characters.'
    })

    /* The portal only asks for a reason when the app is private. */
    let privateReason: string | undefined
    if (version.private === true) {
      privateReason = await input({
        message: 'Why does this app stay private?',
        default: version.privateReason ?? '',
        validate: value => {
          if (!value.trim()) return 'A reason is required for private apps.'
          return value.length <= 500 ? true : 'Private reason must be at most 500 characters.'
        }
      })
    }

    return { demoUrl, scopesDemoUrl, testCredentials, notes, privateReason }
  }
}
