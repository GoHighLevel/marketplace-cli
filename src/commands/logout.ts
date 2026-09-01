import { Command } from '@oclif/core'

import { getConfig } from '../lib/config/environment.js'
import { clearStoredSession, loadCredentials } from '../lib/auth/token-store.js'

export default class Logout extends Command {
  static description =
    'Log out of the CLI: delete the stored tokens and app selection so every API command requires `ghl login` again'

  static examples = ['<%= config.bin %> logout']

  async run(): Promise<void> {
    const config = getConfig()

    let who: string | undefined
    try {
      const creds = await loadCredentials(config.configDir)
      who = creds.profiles[creds.activeProfile]?.email
    } catch {
      /* A corrupt credentials file should not block logout — delete it anyway. */
    }

    try {
      const removed = await clearStoredSession(config.configDir)
      if (removed.length === 0) {
        this.log('Already logged out — no stored credentials found.')
        return
      }

      this.log(`Logged out${who ? ` ${who}` : ''}`)
      this.log('')
      this.log('Run `ghl login` to authenticate again.')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Logout failed')
    }
  }
}
