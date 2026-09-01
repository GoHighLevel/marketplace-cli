import { Command, Flags } from '@oclif/core'

import { ApiClient } from '../../lib/api/client.js'
import { getConfig } from '../../lib/config/environment.js'
import { formatIsoDate } from '../../lib/shared/date.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { renderTable } from '../../lib/shared/table.js'

export default class AppList extends Command {
  static description = 'List apps in your developer account'

  static examples = [
    '<%= config.bin %> app list',
    '<%= config.bin %> app list --search chat',
    '<%= config.bin %> app list --json'
  ]

  static enableJsonFlag = true

  static flags = {
    limit: Flags.integer({ description: 'Maximum number of apps to return', default: 50 }),
    skip: Flags.integer({ description: 'Number of apps to skip (pagination)', default: 0 }),
    search: Flags.string({ description: 'Filter apps by name' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppList)
    if (!Number.isInteger(flags.limit) || flags.limit < 1 || flags.limit > 100) {
      this.error('--limit must be an integer between 1 and 100.')
    }
    if (!Number.isInteger(flags.skip) || flags.skip < 0) this.error('--skip must be a non-negative integer.')

    const client = new ApiClient(getConfig())
    try {
      const result = await withSpinner(
        'Fetching apps...',
        async () => {
          await client.init()
          return client.listApps({ skip: flags.skip, limit: flags.limit, search: flags.search?.trim() || undefined })
        },
        { quiet: this.jsonEnabled() }
      )

      if (this.jsonEnabled()) return result

      if (result.apps.length === 0) {
        this.log(flags.search ? `No apps matching "${flags.search}".` : 'No apps found in your developer account.')
        return
      }

      const rows = result.apps.map(app => [
        app.name ?? '',
        String(app.appId ?? app._id ?? ''),
        app.status ?? '',
        app.version ?? '',
        app.private ? 'private' : 'public',
        formatIsoDate(app.createdAt)
      ])
      this.log(renderTable(['NAME', 'APP ID', 'STATUS', 'VERSION', 'TYPE', 'CREATED'], rows))
      this.log(`\n${result.apps.length} of ${result.totalCount} apps`)
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to list apps')
    }
  }
}
