import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { createDraftFromLive } from '../../lib/app/release.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppDraft extends GhlCommand {
  static description = 'Create a new draft version from the selected (live) version'

  static examples = ['<%= config.bin %> app draft', '<%= config.bin %> app draft --json']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppDraft)
    const json = this.jsonEnabled()
    const context = await loadAppContext(flags.app, json)
    const versionId = await withSpinner('Creating draft version...', () => createDraftFromLive(context), {
      quiet: json
    })
    if (json) return { appId: context.selected.appId, versionId }
    this.log(`Draft created (versionId: ${versionId}) — selection updated to the new draft.`)
  }
}
