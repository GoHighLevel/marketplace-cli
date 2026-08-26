import { Command } from '@oclif/core'

import { ApiClient } from '../../lib/api/client.js'
import { getConfig } from '../../lib/config/environment.js'
import { developerAccountRecord } from '../../lib/auth/accounts.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { renderTable } from '../../lib/shared/table.js'

export default class AccountList extends Command {
  static description = 'List developer accounts and show which account is active'

  static examples = ['<%= config.bin %> account', '<%= config.bin %> account --json']

  static enableJsonFlag = true

  async run(): Promise<unknown> {
    const client = new ApiClient(getConfig())
    try {
      const teams = await withSpinner(
        'Fetching developer accounts...',
        async () => {
          await client.init()
          const memberships = await client.listDeveloperTeams()
          await client.ensureTeam(memberships)
          return memberships
        },
        { quiet: this.jsonEnabled() }
      )
      const accounts = teams.map(team => developerAccountRecord(team, client.activeTeamId))
      if (this.jsonEnabled()) return { activeAccountId: client.activeTeamId ?? null, accounts }
      this.log(renderTable(
        ['ACTIVE', 'ACCOUNT', 'ACCOUNT ID', 'ROLE'],
        accounts.map(account => [account.active ? '*' : '', account.name, account.accountId, account.role ?? ''])
      ))
      this.log('\nSwitch accounts with `ghl account switch <account-id>`.')
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to list developer accounts.')
    }
  }
}
