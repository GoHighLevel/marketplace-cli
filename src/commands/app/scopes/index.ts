import { Command, Flags } from '@oclif/core'

import { scopeCatalogEntries } from '../../../lib/auth/settings.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { renderTable } from '../../../lib/shared/table.js'

export default class AppScopes extends Command {
  static description = 'Show the OAuth scopes of the selected app'

  static examples = [
    '<%= config.bin %> app scopes',
    '<%= config.bin %> app scopes --available',
    '<%= config.bin %> app scopes add contacts.readonly'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    available: Flags.boolean({ description: 'List scopes available for this app target', default: false })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppScopes)
    try {
      const context = await loadAppContext(flags.app, this.jsonEnabled())
      if (flags.available) {
        const catalog = await withSpinner('Loading scope catalog...', () => context.client.getScopesCatalog(), {
          quiet: this.jsonEnabled()
        })
        const availableScopes = scopeCatalogEntries(catalog, context.version.userTypes ?? [])
        if (this.jsonEnabled()) return { availableScopes }
        if (availableScopes.length === 0) {
          this.log('No OAuth scopes are available for the selected app target.')
          return
        }
        this.log(
          renderTable(
            ['SCOPE', 'DESCRIPTION'],
            availableScopes.map(scope => [scope.scope, scope.description ?? scope.label ?? ''])
          )
        )
        return
      }
      const scopes = context.version.allowedScopes ?? []

      if (this.jsonEnabled()) return { scopes }

      if (scopes.length === 0) {
        this.log('No scopes selected. Add some with `ghl app scopes add <scope...>`.')
        return
      }
      this.log(`${scopes.length} scope(s):`)
      for (const scope of scopes) this.log(`  ${scope}`)
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to load scopes')
    }
  }
}
