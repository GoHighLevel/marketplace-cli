import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { getConfig } from '../../../lib/config/environment.js'
import { input } from '../../../lib/shared/prompts.js'
import {
  canRevealGeneratedSecretInteractively,
  prepareGeneratedSecretOutput,
  storeSecretForOneTimeReveal
} from '../../../lib/secrets/ledger.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppKeysCreate extends GhlCommand {
  static description = 'Create a client key + secret pair for the selected app'

  static examples = ['<%= config.bin %> app keys create production']

  static enableJsonFlag = true

  static args = {
    name: Args.string({ description: 'Name for the client key (prompted when omitted)' })
  }

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    reveal: Flags.boolean({
      description: 'Print the full secret now without retaining a local copy',
      default: false
    })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppKeysCreate)

    if (args.name === undefined && !process.stdin.isTTY) {
      this.error('Pass the key name when running non-interactively, e.g. `ghl app keys create production`.')
    }
    const name = (
      args.name ??
      (await input({
        message: 'Name for the client key:',
        validate: value => (value.trim().length > 0 ? true : 'Client key name is required.')
      }))
    ).trim()
    if (!name) this.error('Client key name is required and cannot be blank.')

    const context = await loadAppContext(flags.app, this.jsonEnabled())
    const created = await withSpinner(
      'Creating client key...',
      () => context.client.addClientKey(context.selected.appId, name),
      { quiet: this.jsonEnabled() }
    )

    const config = getConfig()
    const stored = await storeSecretForOneTimeReveal(
      config.configDir,
      context.client.activeProfileName,
      {
        kind: 'client-secret',
        label: name,
        reference: created.id,
        appId: context.selected.appId,
        value: created.secret
      },
      flags.reveal
    )
    const output = prepareGeneratedSecretOutput(
      created.secret,
      stored,
      flags.reveal,
      canRevealGeneratedSecretInteractively(this.jsonEnabled())
    )
    if (output.unavailable) {
      this.error(
        `Client key ${created.id} was created, but its secret could not be saved locally. ` +
          'It was not printed in this non-interactive session. Delete the key, then retry with --reveal.'
      )
    }
    const secret = output.value

    if (this.jsonEnabled()) {
      return { ...created, secret, secretStored: stored }
    }

    this.log(`Client key created:`)
    this.log(`  Client ID:     ${created.id}`)
    this.log(`  Client secret: ${secret}`)
    if (flags.reveal) {
      this.log('\nThis was the only display. The secret was not retained locally.')
    } else if (stored) {
      this.log('\nThe secret is saved locally — reveal it once with `ghl secrets reveal`.')
    } else {
      this.log('\nSave the secret now — local storage failed and this interactive display is the only copy.')
    }
  }
}
