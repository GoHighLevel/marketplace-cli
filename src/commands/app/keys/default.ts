import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { select } from '../../../lib/shared/prompts.js'
import { liveClientKeys, requireClientKey } from '../../../lib/app/client-keys.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppKeysDefault extends GhlCommand {
  static description = 'Mark a client key as the default one'

  static examples = [
    '<%= config.bin %> app keys default',
    '<%= config.bin %> app keys default <clientKeyId>',
    '<%= config.bin %> app keys default <clientKeyId> --json'
  ]

  static enableJsonFlag = true

  static args = {
    keyId: Args.string({ description: 'Client key id to make default (picked interactively when omitted)' })
  }

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppKeysDefault)
    const json = this.jsonEnabled()

    if (args.keyId === undefined && !(process.stdin.isTTY === true && !json)) {
      this.error('Pass the client key id when running non-interactively, e.g. `ghl app keys default <clientKeyId>`.')
    }

    const context = await loadAppContext(flags.app, json)
    const liveKeys = liveClientKeys(context.version)
    const currentDefault = context.version.defaults?.clientKey

    const keyId =
      args.keyId ??
      (await (async () => {
        if (liveKeys.length === 0) this.error('This app has no client keys.')
        return select({
          message: 'Which client key should be the default?',
          choices: liveKeys.map(key => ({
            name: `${key.name ?? 'unnamed'} (${key.id})${key.id === currentDefault ? ' — current default' : ''}`,
            value: key.id
          }))
        })
      })())

    requireClientKey(context.version, keyId)
    const result = (changed: boolean) => ({ appId: context.selected.appId, clientKeyId: keyId, changed })
    if (currentDefault === keyId) {
      if (json) return result(false)
      this.log(`Client key ${keyId} is already the default.`)
      return
    }
    await withSpinner(
      'Setting default client key...',
      () => context.client.makeClientKeyDefault(context.selected.appId, keyId),
      { quiet: json }
    )
    if (json) return result(true)
    this.log(`Client key ${keyId} is now the default.`)
  }
}
