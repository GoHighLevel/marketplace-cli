import { Args, Command } from '@oclif/core'

import { ApiClient, isDeveloperTeamId } from '../../lib/api/client.js'
import { getConfig } from '../../lib/config/environment.js'
import {
  developerAccountChoice,
  developerAccountName,
  developerAccountRecord,
  developerAccountSummary,
  switchDeveloperAccount
} from '../../lib/auth/accounts.js'
import { isPromptCancel, select } from '../../lib/shared/prompts.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AccountSwitch extends Command {
  static description = 'Switch the active developer account without logging in again'

  static examples = [
    '<%= config.bin %> account switch',
    '<%= config.bin %> account switch 67ee6752f753647b1c9ae06e',
    '<%= config.bin %> account switch 67ee6752f753647b1c9ae06e --json'
  ]

  static enableJsonFlag = true

  static args = {
    accountId: Args.string({ description: 'Account id to activate (omit to pick from a list)', required: false })
  }

  async run(): Promise<unknown> {
    const { args } = await this.parse(AccountSwitch)
    if (!args.accountId && !process.stdin.isTTY) {
      this.error('Pass the account id when running non-interactively, e.g. `ghl account switch <account-id>`.')
    }
    if (args.accountId && !isDeveloperTeamId(args.accountId)) {
      this.error('Account id must contain 1-128 letters, numbers, underscores, or hyphens.')
    }

    const config = getConfig()
    const client = new ApiClient(config)
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
      if (teams.length === 0) {
        throw new Error('No developer accounts are available. Ask an account owner to add you, then retry.')
      }

      const activeTeamId = client.activeTeamId
      const activeAccount = teams.find(team => team.team === activeTeamId)
      if (!args.accountId && activeAccount) {
        this.log(`Current account: ${developerAccountSummary(activeAccount)}`)
      }

      const accountId =
        args.accountId ??
        (await select({
          message: 'Select a developer account:',
          choices: teams.map(team => ({
            name: developerAccountChoice(team, activeTeamId),
            value: team.team
          }))
        }))
      const selected = teams.find(team => team.team === accountId)
      if (!selected) {
        throw new Error(
          `Account ${JSON.stringify(accountId)} is not available. Run \`ghl account\` to list accessible accounts.`
        )
      }

      const { changed, selectedAppCleared } = await withSpinner(
        'Switching developer account...',
        () => switchDeveloperAccount(client, config.configDir, selected, teams),
        { quiet: this.jsonEnabled() }
      )

      const account = developerAccountRecord(selected, changed ? selected.team : client.activeTeamId)
      if (this.jsonEnabled()) return { changed, selectedAppCleared, account }
      if (!changed) {
        this.log(`"${developerAccountName(selected)}" (${selected.team}) is already active.`)
        return
      }
      this.log(`Switched to "${developerAccountName(selected)}" (accountId: ${selected.team}).`)
      if (selectedAppCleared) this.log('The app selected in the previous account was cleared.')
      this.log('Run `ghl app list` to see apps in this account, then `ghl app use` to select one.')
      this.log(
        'Existing app folders remain bound to their original apps; change directories before using another account.'
      )
      return
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to switch developer accounts.')
    }
  }
}
