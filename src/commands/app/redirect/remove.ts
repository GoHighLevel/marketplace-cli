import { Command, Flags } from '@oclif/core'

import { checkbox, isPromptCancel } from '../../../lib/shared/prompts.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { buildAuthSettingsBody, requireAuthPrereqs } from '../../../lib/auth/settings.js'
import { followVersionChange, loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppRedirectRemove extends Command {
  static description = 'Remove OAuth redirect URIs from the selected app'

  static examples = [
    '<%= config.bin %> app redirect remove',
    '<%= config.bin %> app redirect remove https://acme.com/oauth/callback'
  ]

  static strict = false

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AppRedirectRemove)
    let urls: string[]
    try {
      urls = normalizeVariadicArgs(argv as string[], 'redirect URI')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Invalid redirect URI arguments')
    }
    if (urls.length === 0 && !process.stdin.isTTY) {
      this.error('Pass at least one redirect URL to remove.')
    }

    try {
      const context = await loadAppContext(flags.app)
      const current = context.version.redirectUris ?? []

      if (urls.length === 0) {
        if (current.length === 0) this.error('This app has no redirect URIs to remove.')
        urls = await checkbox({
          message: 'Which redirect URIs should be removed?',
          choices: current.map(uri => ({ name: uri, value: uri })),
          validate: choices => (choices.length > 0 ? true : 'Select at least one redirect URI.')
        })
      }

      const next = current.filter(uri => !urls.includes(uri))
      if (next.length === current.length) {
        this.log('None of the given redirect URIs exist on this app.')
        return
      }

      const changes = { redirectUris: next }
      requireAuthPrereqs(context.version, changes, { allowEmpty: true })
      const body = buildAuthSettingsBody(context.version, changes)
      const result = await withSpinner('Saving redirect URIs...', () =>
        context.client.updateAuthSettings(context.selected.appId, context.selected.versionId, body)
      )
      this.log(`Redirect URIs updated (${next.length} total).`)
      await followVersionChange(context, result, message => this.log(message))
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to remove redirect URIs')
    }
  }
}
