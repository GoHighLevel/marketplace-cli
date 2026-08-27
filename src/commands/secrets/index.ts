import { Command, Flags } from '@oclif/core'

import { readPullWorkspaceBinding } from '../../lib/app/pull.js'
import { getConfig } from '../../lib/config/environment.js'
import { getSelectedApp } from '../../lib/config/selection-store.js'
import { renderSecretEntries, scopeSecretEntries } from '../../lib/secrets/display.js'
import { listSecrets, maskSecret } from '../../lib/secrets/ledger.js'
import { loadCredentials } from '../../lib/auth/token-store.js'

export default class Secrets extends Command {
  static description = 'List masked one-time secrets for the current workspace or selected app'

  static examples = [
    '<%= config.bin %> secrets',
    '<%= config.bin %> secrets --app <appId>',
    '<%= config.bin %> secrets --include-account',
    '<%= config.bin %> secrets --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the current workspace or selected app)' }),
    'include-account': Flags.boolean({
      description: 'Also include account-level sandbox passwords',
      default: false
    })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(Secrets)
    const config = getConfig()
    try {
      const creds = await loadCredentials(config.configDir)
      const selected = await getSelectedApp(config.configDir, creds.activeProfile)
      const workspace = flags.app ? undefined : await readPullWorkspaceBinding(process.cwd())
      const appId = flags.app ?? workspace?.appId ?? selected?.appId
      const entries = await listSecrets(config.configDir, creds.activeProfile)

      const { appEntries, visible } = scopeSecretEntries(entries, appId, flags['include-account'])

      if (this.jsonEnabled()) {
        return { appId: appId ?? null, secrets: visible.map(entry => ({ ...entry, value: maskSecret(entry.value) })) }
      }

      if (!appId) {
        this.log('No app selected — showing account-level secrets only.')
        this.log('Select an app with `ghl app use` (or pass --app) to see its captured secrets.\n')
      } else if (appEntries.length === 0) {
        this.log(`No captured secrets for app ${appId}.`)
        this.log('One-time values are only recorded when created by this CLI. If this app\'s')
        this.log('credentials were created elsewhere, rotate them (e.g. `ghl app keys create`).\n')
      }

      if (visible.length === 0) return

      for (const line of renderSecretEntries(visible, false)) this.log(line)
      this.log('\nReveal and remove the actual values with `ghl secrets reveal` (interactive terminal only).')
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to list secrets')
    }
  }
}
