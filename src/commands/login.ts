import { Flags, ux } from '@oclif/core'
import open from 'open'

import { GhlCommand } from '../lib/shared/command.js'
import { errorMessage } from '../lib/shared/errors.js'
import { getConfig } from '../lib/config/environment.js'
import { startBrowserLogin } from '../lib/auth/browser-login.js'
import { withSpinner } from '../lib/shared/spinner.js'
import { validateProfileName } from '../lib/shared/validation.js'

export function loginSuccessMessage(developer?: string): string {
  return `Logged in successfully${developer ? ` as ${developer}` : ''}.`
}

export default class Login extends GhlCommand {
  static description = 'Log in to your GoHighLevel developer account'

  static examples = ['<%= config.bin %> login', '<%= config.bin %> login --no-browser']

  static enableJsonFlag = true

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

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(Login)
    const json = this.jsonEnabled()
    // stdout carries only the JSON result, so guidance goes to stderr (logToStderr is muted under --json).
    const progress = (message: string) => (json ? ux.stderr(message) : this.log(message))
    const profileName = flags.profile.trim()
    const profileValidation = validateProfileName(profileName)
    if (profileValidation !== true) this.error(profileValidation)
    const config = getConfig()
    const login = await startBrowserLogin(config, profileName)

    progress('Opening your browser to log in to the GHL developer portal...')
    progress(`If the browser did not open, visit:\n\n  ${login.url}\n`)

    if (!flags['no-browser']) {
      await open(login.url).catch(() => {
        /* URL is already printed above, so a failed open is not fatal. */
      })
    }

    let code: string
    try {
      code = await withSpinner(
        'Waiting for approval in the browser (times out in 5 minutes)...',
        () => login.approval,
        { quiet: json }
      )
    } catch (error) {
      login.close()
      this.error(errorMessage(error, 'Login failed'))
    }

    const who = await withSpinner('Signing you in...', () => login.signIn(code), { quiet: json })
    if (json) return { profile: profileName, developer: who ?? null }
    this.log(`\n${loginSuccessMessage(who)}`)
  }
}
