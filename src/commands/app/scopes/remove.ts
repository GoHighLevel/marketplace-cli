import { Command, Flags } from '@oclif/core'

import { checkboxSearch, confirm, isPromptCancel } from '../../../lib/shared/prompts.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { buildAuthSettingsBody, requireAuthPrereqs, pruneEventsForScopes } from '../../../lib/auth/settings.js'
import { followVersionChange, loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppScopesRemove extends Command {
  static description = 'Remove OAuth scopes from the selected app'

  static examples = ['<%= config.bin %> app scopes remove', '<%= config.bin %> app scopes remove contacts.readonly']

  static strict = false

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip confirmation when dependent webhooks will be removed', default: false })
  }

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AppScopesRemove)
    let scopes: string[]
    try {
      scopes = normalizeVariadicArgs(argv as string[], 'scope')
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Invalid scope arguments')
    }
    if (scopes.length === 0 && !process.stdin.isTTY) {
      this.error('Pass at least one scope to remove.')
    }

    try {
      const context = await loadAppContext(flags.app)
      const current = context.version.allowedScopes ?? []

      if (scopes.length === 0) {
        if (current.length === 0) this.error('This app has no scopes to remove.')
        scopes = await checkboxSearch({
          message: 'Which scopes should be removed?',
          choices: current.map(scope => ({ name: scope, value: scope })),
          pageSize: 15,
          validate: choices => (choices.length > 0 ? true : 'Select at least one scope.')
        })
      }

      const next = current.filter(scope => !scopes.includes(scope))
      if (next.length === current.length) {
        this.log('None of the given scopes are currently selected.')
        return
      }

      /* Dropping a scope also drops the webhook events it enabled. */
      const catalog = await context.client.getWebhooksCatalog()
      const events = pruneEventsForScopes(context.version.subscribedEvents ?? [], next, catalog)
      const removedEvents = (context.version.subscribedEvents ?? []).length - events.length
      if (removedEvents > 0 && !flags.force) {
        if (!process.stdin.isTTY) {
          this.error(
            `${removedEvents} dependent webhook subscription(s) will be removed; pass --force non-interactively.`
          )
        }
        const ok = await confirm({
          message: `Remove the scopes and ${removedEvents} dependent webhook subscription(s)?`,
          default: false
        })
        if (!ok) return
      }

      const changes = { scopes: next, subscribedEvents: events }
      requireAuthPrereqs(context.version, changes, { allowEmpty: true })
      const body = buildAuthSettingsBody(context.version, changes)
      const result = await withSpinner('Saving scopes...', () =>
        context.client.updateAuthSettings(context.selected.appId, context.selected.versionId, body)
      )
      this.log(`Scopes updated (${next.length} total).`)
      if (removedEvents > 0) {
        this.log(`${removedEvents} webhook event subscription(s) depending on removed scopes were unsubscribed.`)
      }
      await followVersionChange(context, result, message => this.log(message))
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to remove scopes')
    }
  }
}
