import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { confirm, select } from '../../../lib/shared/prompts.js'
import { deleteClientKeyAndSecret, liveClientKeys, requireClientKey } from '../../../lib/app/client-keys.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppKeysDelete extends GhlCommand {
  static description = 'Delete a client key from the selected app'

  static examples = [
    '<%= config.bin %> app keys delete <clientKeyId> --force',
    '<%= config.bin %> app keys delete <clientKeyId> --force --json'
  ]

  static enableJsonFlag = true

  static args = {
    keyId: Args.string({ description: 'Client key id to delete (picked interactively when omitted)' })
  }

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppKeysDelete)
    const json = this.jsonEnabled()
    const interactive = process.stdin.isTTY === true && !json

    if (args.keyId === undefined && !interactive) {
      this.error('Pass the client key id when running non-interactively, e.g. `ghl app keys delete <clientKeyId>`.')
    }

    const context = await loadAppContext(flags.app, json)
    const liveKeys = liveClientKeys(context.version)

    const keyId =
      args.keyId ??
      (await (async () => {
        if (liveKeys.length === 0) this.error('This app has no client keys to delete.')
        return select({
          message: 'Which client key should be deleted?',
          choices: liveKeys.map(key => ({ name: `${key.name ?? 'unnamed'} (${key.id})`, value: key.id }))
        })
      })())

    requireClientKey(context.version, keyId)
    if (!flags.force) {
      if (!interactive) {
        this.error('Deleting a client key breaks integrations using it — pass --force when running non-interactively.')
      }
      const ok = await confirm({
        message: `Delete client key ${keyId}? Integrations using it will stop working.`,
        default: false
      })
      if (!ok) return
    }
    const ledgerUpdated = await withSpinner('Deleting client key...', () => deleteClientKeyAndSecret(context, keyId), {
      quiet: json
    })
    if (json) return { appId: context.selected.appId, clientKeyId: keyId, deleted: true, ledgerUpdated }
    if (!ledgerUpdated) {
      this.warn('Could not update the local secrets ledger — `ghl secrets` may show a stale entry.')
    }

    this.log(`Client key ${keyId} deleted.`)
  }
}
