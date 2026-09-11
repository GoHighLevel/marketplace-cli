import { Command, Flags } from '@oclif/core'

import { checkboxSearch, confirm, input, isPromptCancel } from '../../../lib/shared/prompts.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import {
  type AuthSettingsChanges,
  buildAuthSettingsBody,
  requireAuthPrereqs,
  scopeCatalogEntries
} from '../../../lib/auth/settings.js'
import { followVersionChange, loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { validateHttpUrl } from '../../../lib/shared/validation.js'

const SENSITIVE_SCOPES = ['users.write', 'locations.write']

export default class AppScopesAdd extends Command {
  static description = 'Add OAuth scopes to the selected app'

  static examples = [
    '<%= config.bin %> app scopes add',
    '<%= config.bin %> app scopes add contacts.readonly locations.readonly',
    '<%= config.bin %> app scopes add contacts.readonly --redirect https://acme.com/oauth/callback'
  ]

  static strict = false

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    redirect: Flags.string({
      description: 'Redirect URI to add in the same save (required for the first auth setup)'
    }),
    force: Flags.boolean({ description: 'Skip confirmation for sensitive scopes', default: false })
  }

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AppScopesAdd)
    const interactive = process.stdin.isTTY
    let scopes: string[]
    try {
      scopes = normalizeVariadicArgs(argv as string[], 'scope')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Invalid scope arguments')
    }
    if (scopes.length === 0 && !interactive) {
      this.error('Pass at least one scope, e.g. `ghl app scopes add contacts.readonly`.')
    }

    try {
      const context = await loadAppContext(flags.app)
      const catalog = scopeCatalogEntries(await context.client.getScopesCatalog(), context.version.userTypes ?? [])
      const availableScopes = new Set(catalog.map(entry => entry.scope))
      const current = context.version.allowedScopes ?? []

      if (scopes.length === 0) {
        const selected = new Set(current)
        const addable = catalog.filter(entry => !selected.has(entry.scope))
        if (addable.length === 0) this.error('Every available scope is already added.')
        scopes = await checkboxSearch({
          message: 'Which scopes should be added?',
          choices: addable.map(entry => ({
            name: SENSITIVE_SCOPES.includes(entry.scope) ? `${entry.scope} (sensitive)` : entry.scope,
            value: entry.scope,
            ...(entry.description ? { description: entry.description } : {})
          })),
          pageSize: 15,
          validate: choices => (choices.length > 0 ? true : 'Select at least one scope.')
        })
      }

      const unknownScopes = scopes.filter(scope => !availableScopes.has(scope))
      if (unknownScopes.length > 0) {
        this.error(`Unknown marketplace OAuth scope(s): ${unknownScopes.join(', ')}.`)
      }
      const next = [...new Set([...current, ...scopes])]
      const sensitive = scopes.filter(scope => SENSITIVE_SCOPES.includes(scope) && !current.includes(scope))
      if (sensitive.length > 0 && !flags.force) {
        if (!interactive) {
          this.error(`Sensitive scope(s) ${sensitive.join(', ')} require confirmation; pass --force non-interactively.`)
        }
        const ok = await confirm({
          message: `Add sensitive OAuth scope(s) ${sensitive.join(', ')}? These grant broad write access.`,
          default: false
        })
        if (!ok) return
      }

      /* The first auth save must include a redirect URI — collect it here
         instead of failing the prereq check. */
      let redirect = flags.redirect
      if (redirect === undefined && (context.version.redirectUris ?? []).length === 0 && interactive) {
        redirect = await input({
          message: 'First auth setup needs a redirect URI — enter one (http(s)):',
          validate: value => validateHttpUrl(value, 'Redirect URI')
        })
      }

      const changes: AuthSettingsChanges = { scopes: next }
      if (redirect) {
        changes.redirectUris = [...new Set([...(context.version.redirectUris ?? []), redirect])]
      }
      if (next.length === current.length && !redirect) {
        this.log('All given scopes are already selected.')
        return
      }

      requireAuthPrereqs(context.version, changes)
      const body = buildAuthSettingsBody(context.version, changes)
      const result = await withSpinner('Saving scopes...', () =>
        context.client.updateAuthSettings(context.selected.appId, context.selected.versionId, body)
      )
      this.log(`Scopes updated (${next.length} total).`)
      await followVersionChange(context, result, message => this.log(message))
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to add scopes')
    }
  }
}
