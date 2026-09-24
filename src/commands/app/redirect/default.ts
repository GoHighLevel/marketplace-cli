import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { select } from '../../../lib/shared/prompts.js'
import { requireVersionStatus } from '../../../lib/app/rules.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppRedirectDefault extends GhlCommand {
  static description = 'Mark a redirect URI as the default one'

  static examples = [
    '<%= config.bin %> app redirect default',
    '<%= config.bin %> app redirect default https://acme.com/oauth/callback'
  ]

  static args = {
    url: Args.string({ description: 'Redirect URI to make default (picked interactively when omitted)' })
  }

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parse(AppRedirectDefault)

    if (args.url === undefined && !process.stdin.isTTY) {
      this.error('Pass the redirect URI when running non-interactively, e.g. `ghl app redirect default <url>`.')
    }

    const context = await loadAppContext(flags.app)
    requireVersionStatus(context.version.status, ['live', 'deprecating', 'deprecated'], 'set a default redirect URI on')
    const uris = context.version.redirectUris ?? []
    const currentDefault = context.version.defaults?.redirectUrl

    const url =
      args.url ??
      (await (async () => {
        if (uris.length === 0) this.error('This app has no redirect URIs — add one with `ghl app redirect add`.')
        return select({
          message: 'Which redirect URI should be the default?',
          choices: uris.map(uri => ({
            name: `${uri}${uri === currentDefault ? ' — current default' : ''}`,
            value: uri
          }))
        })
      })())

    if (!uris.includes(url)) {
      this.error(`"${url}" is not one of this app's redirect URIs — add it first with \`ghl app redirect add\`.`)
    }
    if (currentDefault === url) {
      this.log(`${url} is already the default redirect URI.`)
      return
    }
    await withSpinner('Setting default redirect URI...', () =>
      context.client.makeRedirectUrlDefault(context.selected.appId, context.selected.versionId, url)
    )
    this.log(`Default redirect URI set to ${url}.`)
  }
}
