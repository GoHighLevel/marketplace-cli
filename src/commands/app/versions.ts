import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { renderTable } from '../../lib/shared/table.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppVersions extends GhlCommand {
  static description = 'List all versions of the selected app'

  static examples = ['<%= config.bin %> app versions']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppVersions)
    const context = await loadAppContext(flags.app, this.jsonEnabled())
    const versions = await withSpinner(
      'Loading versions...',
      () => context.client.listVersions(context.selected.appId),
      { quiet: this.jsonEnabled() }
    )

    if (this.jsonEnabled()) return { versions }

    if (versions.length === 0) {
      this.log('No versions found for the selected app.')
      return
    }

    const rows = versions.map(version => [
      String(version._id),
      version.version ?? '',
      version.status ?? '',
      version._id === context.selected.versionId ? '(selected)' : ''
    ])
    this.log(renderTable(['VERSION ID', 'VERSION', 'STATUS', ''], rows))
  }
}
