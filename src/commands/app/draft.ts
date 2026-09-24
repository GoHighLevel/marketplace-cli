import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { persistSelection } from '../../lib/app/context.js'
import { requireVersionStatus } from '../../lib/app/rules.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { requireDraftable } from '../../lib/app/versioning.js'

export default class AppDraft extends GhlCommand {
  static description = 'Create a new draft version from the selected (live) version'

  static examples = ['<%= config.bin %> app draft']

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<void> {
    const { flags } = await this.parse(AppDraft)
    const context = await loadAppContext(flags.app)
    requireVersionStatus(context.version.status, ['live'], 'create a draft from')
    const versions = await withSpinner('Checking versions...', () =>
      context.client.listVersions(context.selected.appId)
    )
    requireDraftable(versions, context.selected.versionId)
    const created = await withSpinner('Creating draft version...', () =>
      context.client.cloneAsDraft(context.selected.appId, context.selected.versionId)
    )

    await persistSelection(context.client, context.config, {
      ...context.selected,
      versionId: created.id
    })
    this.log(`Draft created (versionId: ${created.id}) — selection updated to the new draft.`)
  }
}
