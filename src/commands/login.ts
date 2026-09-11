import { Command, Flags } from '@oclif/core'
import open from 'open'

import { exchangeCodeForTokens, storedProfileFromTokenResponse } from '../lib/api/token-exchange.js'
import { getConfig } from '../lib/config/environment.js'
import { startLoopbackServer } from '../lib/auth/loopback.js'
import { generatePkcePair, generateState } from '../lib/auth/pkce.js'
import { withSpinner } from '../lib/shared/spinner.js'
import { saveProfile } from '../lib/auth/token-store.js'
import { validateProfileName } from '../lib/shared/validation.js'

interface AuthorizeUrlOptions {
  challenge: string
  state: string
  port: number
}

export function buildAuthorizeUrl(portalUrl: string, options: AuthorizeUrlOptions): URL {
  const authorizeUrl = new URL('/cli-auth', portalUrl)
  authorizeUrl.searchParams.set('challenge', options.challenge)
  authorizeUrl.searchParams.set('state', options.state)
  authorizeUrl.searchParams.set('port', String(options.port))
  return authorizeUrl
}

export function loginSuccessMessage(developer?: string): string {
  return `Logged in successfully${developer ? ` as ${developer}` : ''}.`
}

export default class Login extends Command {
  static description = 'Log in to your GoHighLevel developer account'

  static examples = ['<%= config.bin %> login', '<%= config.bin %> login --no-browser']

  static flags = {
    'no-browser': Flags.boolean({
      description: 'Print the login URL instead of opening a browser',
      default: false
    }),
    profile: Flags.string({
      description: 'Name for the stored credentials profile',
      default: 'default'
    })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Login)
    const profileName = flags.profile.trim()
    const profileValidation = validateProfileName(profileName)
    if (profileValidation !== true) this.error(profileValidation)
    const config = getConfig()

    const { verifier, challenge } = generatePkcePair()
    const state = generateState()

    const server = await startLoopbackServer(state)
    const authorizeUrl = buildAuthorizeUrl(config.portalUrl, {
      challenge,
      state,
      port: server.port
    })

    this.log('Opening your browser to log in to the GHL developer portal...')
    this.log(`If the browser did not open, visit:\n\n  ${authorizeUrl.href}\n`)

    if (!flags['no-browser']) {
      await open(authorizeUrl.href).catch(() => {
        /* URL is already printed above, so a failed open is not fatal. */
      })
    }

    let code: string
    try {
      code = await withSpinner(
        'Waiting for approval in the browser (times out in 5 minutes)...',
        () => server.waitForCode
      )
    } catch (error) {
      server.close()
      this.error(error instanceof Error ? error.message : 'Login failed')
    }

    const tokens = await withSpinner('Signing you in...', () => exchangeCodeForTokens(config.apiUrl, code, verifier))

    await saveProfile(config.configDir, profileName, storedProfileFromTokenResponse(tokens))

    const who = tokens.developer?.email ?? tokens.developer?.name ?? tokens.developer?.id
    this.log(`\n${loginSuccessMessage(who)}`)
  }
}
