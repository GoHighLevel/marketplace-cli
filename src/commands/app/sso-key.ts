import { Command, Flags } from '@oclif/core'

import { getConfig } from '../../lib/config/environment.js'
import { confirm, isPromptCancel } from '../../lib/shared/prompts.js'
import {
  canRevealGeneratedSecretInteractively,
  prepareGeneratedSecretOutput,
  storeSecretForOneTimeReveal
} from '../../lib/secrets/ledger.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppSsoKey extends Command {
  static description = 'Generate (or rotate) the SSO key of the selected app'

  static examples = ['<%= config.bin %> app sso-key', '<%= config.bin %> app sso-key --force --reveal']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the rotation confirmation prompt', default: false }),
    reveal: Flags.boolean({
      description: 'Print the full key (required when running non-interactively)',
      default: false
    })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppSsoKey)
    const interactiveOutput = canRevealGeneratedSecretInteractively(this.jsonEnabled())

    if (!interactiveOutput && !flags.reveal) {
      this.error('Non-interactive SSO key rotation requires --reveal so the one-time replacement key is not lost.')
    }

    try {
      if (!flags.force) {
        if (!process.stdin.isTTY) {
          this.error('Generating a new SSO key invalidates the previous one — pass --force when running non-interactively.')
        }
        const ok = await confirm({
          message: 'Generate a new SSO key? Any previous key stops working.',
          default: false
        })
        if (!ok) return
      }

      const context = await loadAppContext(flags.app, this.jsonEnabled())
      const result = await withSpinner(
        'Generating SSO key...',
        () => context.client.generateSsoKey(context.selected.appId),
        { quiet: this.jsonEnabled() }
      )

      const config = getConfig()
      const stored = await storeSecretForOneTimeReveal(
        config.configDir,
        context.client.activeProfileName,
        {
          kind: 'sso-key',
          label: context.version.name ?? context.selected.appId,
          reference: context.selected.appId,
          appId: context.selected.appId,
          value: result.ssoKey
        },
        flags.reveal,
        { kind: 'sso-key', appId: context.selected.appId }
      )
      const output = prepareGeneratedSecretOutput(
        result.ssoKey,
        stored,
        flags.reveal,
        interactiveOutput
      )
      if (output.unavailable) {
        this.error(
          'The SSO key was rotated, but the new key could not be saved locally. ' +
            'It was not printed in this non-interactive session. Retry with --force --reveal.'
        )
      }
      const ssoKey = output.value

      if (this.jsonEnabled()) return { ...result, ssoKey, secretStored: stored }

      this.log(`SSO key: ${ssoKey}`)
      if (flags.reveal) {
        this.log('This was the only display. The key was not retained locally.')
      } else if (stored) {
        this.log('The key is saved locally — reveal it once with `ghl secrets reveal`.')
      } else {
        this.log('Save it now — local storage failed and this interactive display is the only copy.')
      }
      return
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to generate SSO key')
    }
  }
}
