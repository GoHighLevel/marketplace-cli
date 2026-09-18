import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { confirm, input } from '../../lib/shared/prompts.js'
import type { AppVersion } from '../../lib/api/types.js'
import {
  buildProfilesBody,
  type ProfilesChanges,
  validateDescription,
  validateProfilesBody
} from '../../lib/app/profile-sections.js'
import { followVersionChange, loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { validateYouTubeUrl } from '../../lib/shared/validation.js'

export default class AppProfiles extends GhlCommand {
  static description = 'Edit the agency and sub-account profiles of the selected app'

  static examples = [
    '<%= config.bin %> app profiles',
    '<%= config.bin %> app profiles --description "Full description..." --video-url https://youtu.be/x'
  ]

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    description: Flags.string({ description: 'Agency profile description' }),
    'video-url': Flags.string({ description: 'Agency preview video URL (HTTPS YouTube)' }),
    'sub-account': Flags.boolean({ description: 'Enable a separate sub-account profile', allowNo: true }),
    'sub-description': Flags.string({ description: 'Sub-account profile description' }),
    'sub-video-url': Flags.string({ description: 'Sub-account preview video URL (HTTPS YouTube)' })
  }

  protected async execute(): Promise<void> {
    const { flags } = await this.parse(AppProfiles)
    const changes = this.changesFromFlags(flags)
    const hasFlagChanges = Object.keys(changes).length > 0

    if (!hasFlagChanges && !process.stdin.isTTY) {
      this.error('Pass at least one field flag (--description, --sub-account, ...) when running non-interactively.')
    }

    const context = await loadAppContext(flags.app)
    const finalChanges = hasFlagChanges ? changes : await this.promptChanges(context.version)

    /* Enabling the sub-account profile requires 3+ screenshots already attached. */
    const enablingSubProfile = finalChanges.hasSubAccountProfile === true && !context.version.hasSubAccountProfile
    if (enablingSubProfile && (context.version.subAccountPreviewImageUrls ?? []).length < 3) {
      this.error(
        'Enabling the sub-account profile requires at least 3 screenshots. ' +
          'Run `ghl app media upload <3+ files> --profile sub-account` first — it enables the profile automatically.'
      )
    }

    const body = buildProfilesBody(context.version, finalChanges)
    const validation = validateProfilesBody(body)
    if (validation !== true) this.error(validation)
    const result = await withSpinner('Saving app profiles...', () =>
      context.client.updateProfileSection('appProfiles', context.selected.appId, context.selected.versionId, body)
    )
    this.log('App profiles updated. (Screenshots are managed with `ghl app media upload`.)')
    await followVersionChange(context, result, message => this.log(message))
  }

  private changesFromFlags(flags: {
    description?: string
    'video-url'?: string
    'sub-account'?: boolean
    'sub-description'?: string
    'sub-video-url'?: string
  }): ProfilesChanges {
    const changes: ProfilesChanges = {}
    if (flags.description !== undefined) {
      const check = validateDescription(flags.description)
      if (check !== true) this.error(check)
      changes.description = flags.description
    }
    if (flags['video-url'] !== undefined) changes.previewVideoUrl = flags['video-url']
    if (flags['sub-account'] !== undefined) changes.hasSubAccountProfile = flags['sub-account']
    if (flags['sub-description'] !== undefined) {
      const check = validateDescription(flags['sub-description'])
      if (check !== true) this.error(check)
      changes.subAccountDescription = flags['sub-description']
    }
    if (flags['sub-video-url'] !== undefined) changes.subAccountPreviewVideoUrl = flags['sub-video-url']
    return changes
  }

  private async promptChanges(version: AppVersion): Promise<ProfilesChanges> {
    const description = await input({
      message: 'Agency profile description (300-5000 characters):',
      default: version.description ?? '',
      validate: value => validateDescription(value)
    })
    const previewVideoUrl = await input({
      message: 'Agency preview video URL (optional):',
      default: version.previewVideoUrl ?? '',
      validate: value => (value.trim() ? validateYouTubeUrl(value, 'Preview video URL') : true)
    })

    const hasSubAccountProfile = await confirm({
      message: 'Use a separate profile for sub-accounts?',
      default: version.hasSubAccountProfile ?? false
    })

    const changes: ProfilesChanges = { description, previewVideoUrl, hasSubAccountProfile }
    if (hasSubAccountProfile) {
      changes.subAccountDescription = await input({
        message: 'Sub-account profile description (300-5000 characters):',
        default: version.subAccountDescription ?? '',
        validate: value => validateDescription(value)
      })
      changes.subAccountPreviewVideoUrl = await input({
        message: 'Sub-account preview video URL (optional):',
        default: version.subAccountPreviewVideoUrl ?? '',
        validate: value => (value.trim() ? validateYouTubeUrl(value, 'Sub-account preview video URL') : true)
      })
    }
    return changes
  }
}
