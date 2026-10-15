import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { errorMessage } from '../../../lib/shared/errors.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { uploadMedia } from '../../../lib/app/media-sync.js'
import { loadAppContext, versionResult } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppMediaUpload extends GhlCommand {
  static description = 'Upload the app logo or screenshots and attach them to the app'

  static examples = [
    '<%= config.bin %> app media upload ./logo.png --logo',
    '<%= config.bin %> app media upload ./shot1.png ./shot2.png ./shot3.png',
    '<%= config.bin %> app media upload ./sub1.png --profile sub-account',
    '<%= config.bin %> app media upload ./logo.png --logo --json'
  ]

  static enableJsonFlag = true

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

  protected async execute(): Promise<unknown> {
    const { argv, flags } = await this.parse(AppMediaUpload)
    const json = this.jsonEnabled()
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

    const context = await loadAppContext(flags.app, json)
    const profile = flags.profile === 'sub-account' ? 'sub-account' : 'agency'
    const uploaded = await withSpinner(
      `Uploading ${files.length} file(s)...`,
      () => uploadMedia(context, { files, logo: flags.logo, profile }),
      { quiet: json }
    )
    if (json) {
      const { urls, total, subAccountProfileEnabled, notes } = uploaded
      return versionResult(
        context,
        { urls, ...(total === undefined ? {} : { total }), subAccountProfileEnabled },
        notes
      )
    }
    if (flags.logo) {
      this.log(`Logo updated: ${uploaded.urls[0]}`)
    } else {
      if (uploaded.subAccountProfileEnabled) {
        this.log('Sub-account profile was enabled automatically using the agency description.')
      }
      this.log(`Added ${uploaded.urls.length} screenshot(s) to the ${profile} profile (${uploaded.total} total):`)
      for (const url of uploaded.urls) this.log(`  ${url}`)
    }
    for (const note of uploaded.notes) this.log(note)
  }
}
