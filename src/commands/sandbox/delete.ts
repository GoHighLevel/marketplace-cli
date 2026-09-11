import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { ApiClient, type SandboxAccount } from '../../lib/api/client.js'
import { getConfig } from '../../lib/config/environment.js'
import { confirm, select } from '../../lib/shared/prompts.js'
import { removeSecrets } from '../../lib/secrets/ledger.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class SandboxDelete extends GhlCommand {
  static description = 'Delete a sandbox agency account from your developer account'

  static examples = ['<%= config.bin %> sandbox delete', '<%= config.bin %> sandbox delete <companyId> --force']

  static args = {
    companyId: Args.string({ description: 'Company id of the sandbox to delete (picked interactively when omitted)' })
  }

  static flags = {
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parse(SandboxDelete)

    if (args.companyId === undefined && !process.stdin.isTTY) {
      this.error('Pass the sandbox company id when running non-interactively, e.g. `ghl sandbox delete <companyId>`.')
    }
    if (!flags.force && !process.stdin.isTTY) {
      this.error('Deleting a sandbox removes the agency and its data — pass --force when running non-interactively.')
    }

    const client = new ApiClient(getConfig())
    const result = await withSpinner('Fetching sandbox accounts...', async () => {
      await client.init()
      return client.listSandboxAccounts()
    })
    const accounts = result.accounts.filter(account => account._id)
    if (accounts.length === 0) this.error('You have no sandbox accounts to delete.')

    const account =
      args.companyId === undefined
        ? await select({
            message: 'Which sandbox account should be deleted?',
            choices: accounts.map(item => ({ name: this.describe(item), value: item }))
          })
        : accounts.find(item => item.companyId === args.companyId || item._id === args.companyId)
    if (!account) {
      this.error(`No sandbox account found with company id "${args.companyId}". Run \`ghl sandbox\` to list them.`)
    }

    if (!flags.force) {
      const ok = await confirm({
        message: `Delete sandbox ${this.describe(account)}? The agency and its data will be removed.`,
        default: false
      })
      if (!ok) return
    }

    await withSpinner('Deleting sandbox account...', () => client.deleteSandboxAccount(account._id as string))

    /* The account is gone, so its ledgered password is useless — prune it.
       Best-effort: the deletion itself already succeeded. */
    try {
      const config = getConfig()
      await removeSecrets(config.configDir, client.activeProfileName, {
        kind: 'sandbox-password',
        reference: account.companyId
      })
    } catch {
      this.warn('Could not update the local secrets ledger — `ghl secrets` may show a stale entry.')
    }

    this.log(`Sandbox account ${this.describe(account)} deleted.`)
  }

  private describe(account: SandboxAccount): string {
    return `${account.name ?? 'unnamed'} (${account.companyId ?? account._id})`
  }
}
