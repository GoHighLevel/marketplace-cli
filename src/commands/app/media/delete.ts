import { Command, Flags } from '@oclif/core'

import { confirm, isPromptCancel } from '../../../lib/shared/prompts.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { locateMedia } from '../../../lib/app/media.js'
import { buildBasicInfoBody, buildProfilesBody } from '../../../lib/app/profile-sections.js'
import { followVersionChange, loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppMediaDelete extends Command {
  static description = 'Delete uploaded media (logo or screenshots) from the app'

  static examples = ['<%= config.bin %> app media delete https://.../screenshot1.png --force']

  static strict = false

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AppMediaDelete)
    let urls: string[]
    try {
      urls = normalizeVariadicArgs(argv as string[], 'media URL')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Invalid media URL arguments')
    }

    if (urls.length === 0) {
      this.error('Pass at least one media URL (see `ghl app info --json` for current URLs).')
    }

    try {
      const context = await loadAppContext(flags.app)
      const location = locateMedia(urls, context.version)
      if (location.unknown.length > 0) {
        this.error(`Not found on this app version: ${location.unknown.join(', ')}`)
      }
      if (!flags.force) {
        if (!process.stdin.isTTY) {
          this.error('Deleting media is irreversible — pass --force when running non-interactively.')
        }
        const ok = await confirm({ message: `Delete ${urls.length} file(s)? This cannot be undone.`, default: false })
        if (!ok) return
      }

      /* Detach from the profile sections first, then remove from storage. */
      if (location.logo) {
        const body = buildBasicInfoBody(context.version, { logoUrl: '' })
        const result = await withSpinner('Removing logo...', () =>
          context.client.updateProfileSection('basicInfo', context.selected.appId, context.selected.versionId, body)
        )
        await followVersionChange(context, result, message => this.log(message))
      }

      if (location.agencyScreenshots.length > 0 || location.subAccountScreenshots.length > 0) {
        const body = buildProfilesBody(context.version, {
          previewImageUrls: (context.version.previewImageUrls ?? []).filter(
            url => !location.agencyScreenshots.includes(url)
          ),
          subAccountPreviewImageUrls: (context.version.subAccountPreviewImageUrls ?? []).filter(
            url => !location.subAccountScreenshots.includes(url)
          )
        })
        const result = await withSpinner('Detaching screenshots...', () =>
          context.client.updateProfileSection('appProfiles', context.selected.appId, context.selected.versionId, body)
        )
        await followVersionChange(context, result, message => this.log(message))
      }

      try {
        await withSpinner('Deleting files from storage...', () =>
          context.client.deleteFiles(context.selected.appId, urls)
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Storage deletion failed.'
        throw new Error(
          `${message} The media was detached from the app, but these files may require manual deletion: ${urls.join(', ')}`
        )
      }
      this.log(`Deleted ${urls.length} file(s).`)
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to delete media')
    }
  }
}
