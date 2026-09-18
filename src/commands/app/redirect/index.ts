import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { loadAppContext } from '../../../lib/app/section-context.js'

export default class AppRedirect extends GhlCommand {
  static description = 'Show the OAuth redirect URIs of the selected app'

  static examples = ['<%= config.bin %> app redirect', '<%= config.bin %> app redirect add https://acme.com/callback']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppRedirect)
    const context = await loadAppContext(flags.app, this.jsonEnabled())
    const redirectUris = context.version.redirectUris ?? []
    const defaultRedirectUri = context.version.defaults?.redirectUrl

    if (this.jsonEnabled()) return { redirectUris, defaultRedirectUri }

    if (redirectUris.length === 0) {
      this.log('No redirect URIs. Add one with `ghl app redirect add <url>`.')
      return
    }
    this.log(`${redirectUris.length} redirect URI(s):`)
    for (const uri of redirectUris) this.log(`  ${uri}${uri === defaultRedirectUri ? '  (default)' : ''}`)
  }
}
