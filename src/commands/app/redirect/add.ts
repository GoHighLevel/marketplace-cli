import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { errorMessage } from '../../../lib/shared/errors.js'
import { input } from '../../../lib/shared/prompts.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { buildAuthSettingsBody, requireAuthPrereqs } from '../../../lib/auth/settings.js'
import { followVersionChange, loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { validateHttpUrl, validateTextForWhiteLabel } from '../../../lib/shared/validation.js'

export default class AppRedirectAdd extends GhlCommand {
  static description = 'Add OAuth redirect URIs to the selected app'

  static examples = [
    '<%= config.bin %> app redirect add',
    '<%= config.bin %> app redirect add https://acme.com/oauth/callback'
  ]

  static strict = false

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<void> {
    const { argv, flags } = await this.parse(AppRedirectAdd)
    let urls: string[]
    try {
      urls = normalizeVariadicArgs(argv as string[], 'redirect URI')
    } catch (error) {
      this.error(errorMessage(error, 'Invalid redirect URI arguments'))
    }
    if (urls.length === 0 && !process.stdin.isTTY) {
      this.error('Pass at least one redirect URL, e.g. `ghl app redirect add https://acme.com/oauth/callback`.')
    }

    const context = await loadAppContext(flags.app)

    /* White-label friendly apps must not expose the GHL brand in OAuth
       URLs — same live check the portal runs while typing. */
    const whiteLabel = context.version.isWhiteLabelFriendly !== false
    const validateOne = (url: string): true | string => {
      const validation = validateHttpUrl(url, `Redirect URI "${url}"`)
      if (validation !== true) return validation
      return whiteLabel ? validateTextForWhiteLabel(url, `Redirect URI "${url}"`) : true
    }

    if (urls.length === 0) {
      const answer = await input({
        message: 'Redirect URI(s) to add (comma-separated, http(s)):',
        validate: value => {
          const list = value
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
          if (list.length === 0) return 'Enter at least one redirect URI.'
          for (const url of list) {
            const check = validateOne(url)
            if (check !== true) return check
          }
          return true
        }
      })
      urls = answer
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    }

    for (const url of urls) {
      const validation = validateOne(url)
      if (validation !== true) this.error(validation)
    }

    const current = context.version.redirectUris ?? []
    const next = [...new Set([...current, ...urls])]
    if (next.length === current.length) {
      this.log('All given redirect URIs already exist.')
      return
    }

    const changes = { redirectUris: next }
    requireAuthPrereqs(context.version, changes)
    const body = buildAuthSettingsBody(context.version, changes)
    const result = await withSpinner('Saving redirect URIs...', () =>
      context.client.updateAuthSettings(context.selected.appId, context.selected.versionId, body)
    )
    this.log(`Redirect URIs updated (${next.length} total).`)
    await followVersionChange(context, result, message => this.log(message))
  }
}
