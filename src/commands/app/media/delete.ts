import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { errorMessage } from '../../../lib/shared/errors.js'
import { confirm } from '../../../lib/shared/prompts.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { deleteMedia, locateAttachedMedia } from '../../../lib/app/media-sync.js'
import { loadAppContext, versionResult } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppMediaDelete extends GhlCommand {
  static description = 'Delete uploaded media (logo or screenshots) from the app'

  static examples = [
    '<%= config.bin %> app media delete https://.../screenshot1.png --force',
    '<%= config.bin %> app media delete https://.../screenshot1.png --force --json'
  ]

  static enableJsonFlag = true

  static strict = false

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  protected async execute(): Promise<unknown> {
    const { argv, flags } = await this.parse(AppMediaDelete)
    const json = this.jsonEnabled()
    let urls: string[]
    try {
      urls = normalizeVariadicArgs(argv as string[], 'media URL')
    } catch (error) {
      this.error(errorMessage(error, 'Invalid media URL arguments'))
    }

    if (urls.length === 0) {
      this.error('Pass at least one media URL (see `ghl app info --json` for current URLs).')
    }

    const context = await loadAppContext(flags.app, json)
    const location = locateAttachedMedia(context, urls)
    if (!flags.force) {
      if (!(process.stdin.isTTY === true && !json)) {
        this.error('Deleting media is irreversible — pass --force when running non-interactively.')
      }
      const ok = await confirm({ message: `Delete ${urls.length} file(s)? This cannot be undone.`, default: false })
      if (!ok) return
    }
    const notes = await withSpinner('Deleting media...', () => deleteMedia(context, urls, location), { quiet: json })
    if (json) return versionResult(context, { deleted: urls }, notes)
    for (const note of notes) this.log(note)
    this.log(`Deleted ${urls.length} file(s).`)
  }
}
