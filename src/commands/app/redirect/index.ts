import { Command, Flags } from '@oclif/core'

import { loadAppContext } from '../../../lib/app/section-context.js'

export default class AppRedirect extends Command {
  static description = 'Show the OAuth redirect URIs of the selected app'

  static examples = ['<%= config.bin %> app redirect', '<%= config.bin %> app redirect add https://acme.com/callback']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppRedirect)
    try {
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
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to load redirect URIs')
    }
  }
}
