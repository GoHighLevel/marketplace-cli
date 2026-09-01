import { Args, Command, Flags } from '@oclif/core'

import { isPromptCancel, select } from '../../../lib/shared/prompts.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppKeysDefault extends Command {
  static description = 'Mark a client key as the default one'

  static examples = ['<%= config.bin %> app keys default', '<%= config.bin %> app keys default <clientKeyId>']

  static args = {
    keyId: Args.string({ description: 'Client key id to make default (picked interactively when omitted)' })
  }

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AppKeysDefault)

    if (args.keyId === undefined && !process.stdin.isTTY) {
      this.error('Pass the client key id when running non-interactively, e.g. `ghl app keys default <clientKeyId>`.')
    }

    try {
      const context = await loadAppContext(flags.app)
      const liveKeys = (context.version.clientKeys ?? []).filter(key => key.id && !key.deleted)
      const currentDefault = context.version.defaults?.clientKey

      const keyId =
        args.keyId ??
        (await (async () => {
          if (liveKeys.length === 0) this.error('This app has no client keys.')
          return select({
            message: 'Which client key should be the default?',
            choices: liveKeys.map(key => ({
              name: `${key.name ?? 'unnamed'} (${key.id})${key.id === currentDefault ? ' — current default' : ''}`,
              value: key.id as string
            }))
          })
        })())

      if (!liveKeys.some(key => key.id === keyId)) {
        this.error(`Client key "${keyId}" was not found on the selected app.`)
      }
      if (currentDefault === keyId) {
        this.log(`Client key ${keyId} is already the default.`)
        return
      }
      await withSpinner('Setting default client key...', () =>
        context.client.makeClientKeyDefault(context.selected.appId, keyId)
      )
      this.log(`Client key ${keyId} is now the default.`)
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to set default client key')
    }
  }
}
