import { Args, Command, Flags } from '@oclif/core'

import { getConfig } from '../../../lib/config/environment.js'
import { confirm, isPromptCancel, select } from '../../../lib/shared/prompts.js'
import { removeSecrets } from '../../../lib/secrets/ledger.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppKeysDelete extends Command {
  static description = 'Delete a client key from the selected app'

  static examples = ['<%= config.bin %> app keys delete <clientKeyId> --force']

  static args = {
    keyId: Args.string({ description: 'Client key id to delete (picked interactively when omitted)' })
  }

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AppKeysDelete)

    if (args.keyId === undefined && !process.stdin.isTTY) {
      this.error('Pass the client key id when running non-interactively, e.g. `ghl app keys delete <clientKeyId>`.')
    }

    try {
      const context = await loadAppContext(flags.app)
      const liveKeys = (context.version.clientKeys ?? []).filter(key => key.id && !key.deleted)

      const keyId =
        args.keyId ??
        (await (async () => {
          if (liveKeys.length === 0) this.error('This app has no client keys to delete.')
          return select({
            message: 'Which client key should be deleted?',
            choices: liveKeys.map(key => ({ name: `${key.name ?? 'unnamed'} (${key.id})`, value: key.id as string }))
          })
        })())

      if (!liveKeys.some(key => key.id === keyId)) {
        this.error(`Client key "${keyId}" was not found on the selected app.`)
      }
      if (!flags.force) {
        if (!process.stdin.isTTY) {
          this.error('Deleting a client key breaks integrations using it — pass --force when running non-interactively.')
        }
        const ok = await confirm({
          message: `Delete client key ${keyId}? Integrations using it will stop working.`,
          default: false
        })
        if (!ok) return
      }
      await withSpinner('Deleting client key...', () =>
        context.client.deleteClientKey(context.selected.appId, keyId)
      )

      /* The key no longer works — drop its ledgered secret so `ghl secrets`
         only shows live credentials. Best-effort: deletion already succeeded. */
      try {
        const config = getConfig()
        await removeSecrets(config.configDir, context.client.activeProfileName, {
          kind: 'client-secret',
          reference: keyId
        })
      } catch {
        this.warn('Could not update the local secrets ledger — `ghl secrets` may show a stale entry.')
      }

      this.log(`Client key ${keyId} deleted.`)
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to delete client key')
    }
  }
}
