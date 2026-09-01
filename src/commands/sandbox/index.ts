import { Command } from '@oclif/core'

import { ApiClient } from '../../lib/api/client.js'
import { getConfig } from '../../lib/config/environment.js'
import { formatIsoDate } from '../../lib/shared/date.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { renderTable } from '../../lib/shared/table.js'

export default class Sandbox extends Command {
  static description = 'List sandbox accounts in your developer account'

  static examples = ['<%= config.bin %> sandbox', '<%= config.bin %> sandbox --json']

  static enableJsonFlag = true

  async run(): Promise<unknown> {
    const client = new ApiClient(getConfig())
    try {
      const result = await withSpinner(
        'Fetching sandbox accounts...',
        async () => {
          await client.init()
          return client.listSandboxAccounts()
        },
        { quiet: this.jsonEnabled() }
      )

      if (this.jsonEnabled()) return result

      if (result.accounts.length === 0) {
        this.log('No sandbox accounts. Create one with `ghl sandbox create`.')
        return
      }

      const rows = result.accounts.map(account => [
        account.name ?? '',
        account.companyId ?? '',
        account.relationshipNumber ?? '',
        account.status ?? '',
        formatIsoDate(account.expiryDate),
        (result.apps[account.companyId ?? ''] ?? []).join(', ')
      ])
      this.log(renderTable(['NAME', 'COMPANY ID', 'REL. NO', 'STATUS', 'EXPIRES', 'CONNECTED APPS'], rows))
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to list sandbox accounts')
    }
  }
}
