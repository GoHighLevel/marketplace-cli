import { Command, Flags } from '@oclif/core'

import { readPullWorkspaceBinding } from '../../lib/app/pull.js'
import { getConfig } from '../../lib/config/environment.js'
import { getSelectedApp } from '../../lib/config/selection-store.js'
import { isSecretInScope, renderSecretEntries, scopeSecretEntries } from '../../lib/secrets/display.js'
import { consumeSecrets } from '../../lib/secrets/ledger.js'
import { loadCredentials } from '../../lib/auth/token-store.js'

export default class SecretsReveal extends Command {
  static description = 'Reveal and permanently remove one-time secrets for the current workspace or selected app'

  static examples = [
    '<%= config.bin %> secrets reveal',
    '<%= config.bin %> secrets reveal --app <appId>',
    '<%= config.bin %> secrets reveal --include-account'
  ]

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the current workspace or selected app)' }),
    'include-account': Flags.boolean({
      description: 'Also include account-level sandbox passwords',
      default: false
    }),
    force: Flags.boolean({
      description: 'Allow revealing outside an interactive terminal (e.g. scripts)',
      default: false
    })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(SecretsReveal)

    /* Agents run without a TTY — keeping reveal interactive-only means stored
       values stay out of automated transcripts unless a human opts in. */
    if (!process.stdin.isTTY && !flags.force) {
      this.error('`secrets reveal` only runs in an interactive terminal. Pass --force to override.')
    }

    const config = getConfig()
    try {
      const creds = await loadCredentials(config.configDir)
      const selected = await getSelectedApp(config.configDir, creds.activeProfile)
      const workspace = flags.app ? undefined : await readPullWorkspaceBinding(process.cwd())
      const appId = flags.app ?? workspace?.appId ?? selected?.appId
      const entries = await consumeSecrets(config.configDir, creds.activeProfile, entry =>
        isSecretInScope(entry, appId, flags['include-account'])
      )

      const { appEntries, visible } = scopeSecretEntries(entries, appId, flags['include-account'])

      if (!appId) {
        this.log('No app selected — showing account-level secrets only.')
        this.log('Select an app with `ghl app use` (or pass --app) to see its captured secrets.\n')
      } else if (appEntries.length === 0) {
        this.log(`No unrevealed secrets for app ${appId}.`)
        this.log("One-time values are only recorded when created by this CLI. If this app's")
        this.log('credentials were created elsewhere, rotate them (e.g. `ghl app keys create`).\n')
      }

      if (visible.length === 0) return

      for (const line of renderSecretEntries(visible, true)) this.log(line)
      this.log('\nThese values were removed from local storage and cannot be revealed again.')
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to reveal secrets')
    }
  }
}
