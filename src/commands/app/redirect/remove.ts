import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { errorMessage } from '../../../lib/shared/errors.js'
import { checkbox } from '../../../lib/shared/prompts.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { buildAuthSettingsBody, requireAuthPrereqs } from '../../../lib/auth/settings.js'
import { followVersionChangeNotes, loadAppContext, versionResult } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppRedirectRemove extends GhlCommand {
  static description = 'Remove OAuth redirect URIs from the selected app'

  static examples = [
    '<%= config.bin %> app redirect remove',
    '<%= config.bin %> app redirect remove https://acme.com/oauth/callback'
  ]

  static enableJsonFlag = true

  static strict = false

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<unknown> {
    const { argv, flags } = await this.parse(AppRedirectRemove)
    const json = this.jsonEnabled()
    const interactive = process.stdin.isTTY === true && !json
    let urls: string[]
    try {
      urls = normalizeVariadicArgs(argv as string[], 'redirect URI')
    } catch (error) {
      this.error(errorMessage(error, 'Invalid redirect URI arguments'))
    }
    if (urls.length === 0 && !interactive) {
      this.error('Pass at least one redirect URL to remove.')
    }

    const context = await loadAppContext(flags.app, json)
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
      if (json) {
        return versionResult(context, { changed: false, redirectUris: current })
      }
      this.log('None of the given redirect URIs exist on this app.')
      return
    }

    const changes = { redirectUris: next }
    requireAuthPrereqs(context.version, changes, { allowEmpty: true })
    const body = buildAuthSettingsBody(context.version, changes)
    const result = await withSpinner(
      'Saving redirect URIs...',
      () => context.client.updateAuthSettings(context.selected.appId, context.selected.versionId, body),
      { quiet: json }
    )
    if (!json) this.log(`Redirect URIs updated (${next.length} total).`)
    const notes = await followVersionChangeNotes(context, result)
    if (!json) {
      for (const note of notes) this.log(note)
      return
    }
    return versionResult(context, { changed: true, redirectUris: next }, notes)
  }
}
