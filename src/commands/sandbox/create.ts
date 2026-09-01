import { Command, Flags } from '@oclif/core'

import { ApiClient } from '../../lib/api/client.js'
import { getConfig } from '../../lib/config/environment.js'
import { formatIsoDate } from '../../lib/shared/date.js'
import { input, isPromptCancel, password as passwordPrompt } from '../../lib/shared/prompts.js'
import { secretForOutput, tryRecordSecret } from '../../lib/secrets/ledger.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { validateSandboxPassword } from '../../lib/shared/validation.js'

export default class SandboxCreate extends Command {
  static description = 'Create a sandbox agency account for testing your apps'

  static examples = [
    '<%= config.bin %> sandbox create',
    '<%= config.bin %> sandbox create --name "Test Agency" --password "MySandbox@Pass1"'
  ]

  static enableJsonFlag = true

  static flags = {
    name: Flags.string({ description: 'Name for the sandbox agency' }),
    password: Flags.string({
      description: 'Password for the sandbox account (12+ chars with upper, lower, number, special)'
    })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(SandboxCreate)

    if ((!flags.name || !flags.password) && !process.stdin.isTTY) {
      this.error('Pass --name and --password when running non-interactively.')
    }

    let name: string
    let password: string
    try {
      name = flags.name?.trim() || (await input({
        message: 'Sandbox agency name:',
        validate: value => (value.trim().length > 0 ? true : 'Agency name is required.')
      }))
      password =
        flags.password ??
        (await passwordPrompt({ message: 'Password for the sandbox account:', validate: validateSandboxPassword }))
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      throw error
    }
    if (!name.trim()) this.error('Agency name is required and cannot be blank.')
    const passwordCheck = validateSandboxPassword(password)
    if (passwordCheck !== true) this.error(passwordCheck)

    const config = getConfig()
    const client = new ApiClient(config)
    try {
      const account = await withSpinner(
        'Creating sandbox account...',
        async () => {
          await client.init()
          return client.createSandboxAccount(name.trim(), password)
        },
        { quiet: this.jsonEnabled() }
      )

      const stored = await tryRecordSecret(
        config.configDir,
        client.activeProfileName,
        {
          kind: 'sandbox-password',
          label: account.name ?? name.trim(),
          reference: account.companyId,
          value: password
        }
      )
      const displayedPassword = secretForOutput(password, stored)

      if (this.jsonEnabled()) return { ...account, password: displayedPassword, passwordStored: stored }

      this.log('Sandbox account created:')
      this.log(`  Name:        ${account.name ?? name.trim()}`)
      this.log(`  Company ID:  ${account.companyId ?? '-'}`)
      this.log(`  Rel. number: ${account.relationshipNumber ?? '-'}`)
      this.log(`  Expires:     ${formatIsoDate(account.expiryDate, '-')}`)
      this.log(`  Password:    ${displayedPassword}`)
      this.log('\nLog in to the agency with your developer email and this password.')
      if (stored) {
        this.log('The password is saved locally — reveal it once with `ghl secrets reveal`.')
      } else {
        this.log('The password was not saved locally; keep the password you supplied to this command.')
      }
      return
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to create sandbox account')
    }
  }
}
