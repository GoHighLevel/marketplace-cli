import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { errorMessage } from '../../../lib/shared/errors.js'
import { type ProfileUpdateResult } from '../../../lib/api/client.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { buildUploadForm, validateScreenshotCount } from '../../../lib/app/media.js'
import {
  buildBasicInfoBody,
  buildProfilesBody,
  validateBasicInfoBody,
  validateDescription
} from '../../../lib/app/profile-sections.js'
import { followVersionChange, loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppMediaUpload extends GhlCommand {
  static description = 'Upload the app logo or screenshots and attach them to the app'

  static examples = [
    '<%= config.bin %> app media upload ./logo.png --logo',
    '<%= config.bin %> app media upload ./shot1.png ./shot2.png ./shot3.png',
    '<%= config.bin %> app media upload ./sub1.png --profile sub-account'
  ]

  static strict = false

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    logo: Flags.boolean({ description: 'Upload as the app logo (exactly one file)', default: false }),
    profile: Flags.string({
      description: 'Which profile the screenshots belong to',
      options: ['agency', 'sub-account'],
      default: 'agency'
    })
  }

  protected async execute(): Promise<void> {
    const { argv, flags } = await this.parse(AppMediaUpload)
    let files: string[]
    try {
      files = normalizeVariadicArgs(argv as string[], 'file path')
    } catch (error) {
      this.error(errorMessage(error, 'Invalid file arguments'))
    }

    if (files.length === 0) {
      this.error('Pass at least one image file path, e.g. `ghl app media upload ./logo.png --logo`.')
    }
    if (flags.logo && files.length !== 1) {
      this.error('--logo takes exactly one file.')
    }

    const context = await loadAppContext(flags.app)
    const subAccount = !flags.logo && flags.profile === 'sub-account'
    const mustEnableSubProfile = subAccount && !context.version.hasSubAccountProfile
    const defaultSubDescription = context.version.subAccountDescription || context.version.description || ''

    if (flags.logo) {
      if (context.version.appType === 'template') {
        this.error('Template app logos are managed with the template workflow and cannot be changed here.')
      }
      const validation = validateBasicInfoBody(
        buildBasicInfoBody(context.version, { logoUrl: 'https://uploads.example.com/logo.png' }),
        context.version.isWhiteLabelFriendly ?? true
      )
      if (validation !== true) {
        this.error(`Complete basic info before uploading a logo: ${validation}`)
      }
    }
    if (mustEnableSubProfile) {
      const total = (context.version.subAccountPreviewImageUrls ?? []).length + files.length
      if (total < 3) {
        this.error(
          'The sub-account profile is not enabled yet and enabling it requires at least 3 screenshots. ' +
            'Upload enough files to reach 3 in a single command.'
        )
      }
      const descriptionValidation = validateDescription(defaultSubDescription)
      if (descriptionValidation !== true) {
        this.error(
          `A valid agency description is required before the CLI can enable the sub-account profile: ${descriptionValidation} ` +
            'Set it with `ghl app profiles --description <text>` first.'
        )
      }
    }
    if (!flags.logo) {
      const currentCount = subAccount
        ? (context.version.subAccountPreviewImageUrls ?? []).length
        : (context.version.previewImageUrls ?? []).length
      const countValidation = validateScreenshotCount(currentCount, files.length)
      if (countValidation !== true) this.error(countValidation)
    }

    const kind = flags.logo ? 'logo' : 'preview'
    const form = await buildUploadForm(files, kind)

    const uploaded = await withSpinner(`Uploading ${files.length} file(s)...`, () =>
      context.client.uploadFiles(context.selected.appId, form)
    )
    const urls = Object.values(uploaded)
    if (urls.length === 0) {
      this.error('Upload failed — no file URLs were returned.')
    }
    if (urls.length !== files.length) {
      try {
        await context.client.deleteFiles(context.selected.appId, urls)
      } catch {
        this.error(
          `Upload returned ${urls.length} URL(s) for ${files.length} file(s), and cleanup failed. ` +
            `Delete these files manually: ${urls.join(', ')}`
        )
      }
      this.error(`Upload returned ${urls.length} URL(s) for ${files.length} file(s); partial uploads were removed.`)
    }

    let result: ProfileUpdateResult
    try {
      if (flags.logo) {
        const body = buildBasicInfoBody(context.version, { logoUrl: urls[0] })
        result = await withSpinner('Setting app logo...', () =>
          context.client.updateProfileSection('basicInfo', context.selected.appId, context.selected.versionId, body)
        )
        this.log(`Logo updated: ${urls[0]}`)
      } else {
        const currentUrls = subAccount
          ? (context.version.subAccountPreviewImageUrls ?? [])
          : (context.version.previewImageUrls ?? [])
        const nextUrls = [...currentUrls, ...urls]
        const body = buildProfilesBody(
          context.version,
          subAccount
            ? {
                subAccountPreviewImageUrls: nextUrls,
                ...(mustEnableSubProfile
                  ? { hasSubAccountProfile: true, subAccountDescription: defaultSubDescription }
                  : {})
              }
            : { previewImageUrls: nextUrls }
        )
        result = await withSpinner('Attaching screenshots...', () =>
          context.client.updateProfileSection('appProfiles', context.selected.appId, context.selected.versionId, body)
        )
        if (mustEnableSubProfile) {
          this.log('Sub-account profile was enabled automatically using the agency description.')
        }
        this.log(`Added ${urls.length} screenshot(s) to the ${flags.profile} profile (${nextUrls.length} total):`)
        for (const url of urls) this.log(`  ${url}`)
      }
    } catch (error) {
      try {
        await context.client.deleteFiles(context.selected.appId, urls)
      } catch {
        const message = errorMessage(error, 'Failed to attach uploaded media.')
        throw new Error(
          `${message} Cleanup also failed; the uploaded files may need manual deletion: ${urls.join(', ')}`
        )
      }
      const message = errorMessage(error, 'Failed to attach uploaded media.')
      throw new Error(`${message} The uploaded files were removed.`)
    }
    await followVersionChange(context, result, message => this.log(message))
  }
}
