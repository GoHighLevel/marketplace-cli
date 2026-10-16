import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { errorMessage } from '../../../lib/shared/errors.js'
import { checkboxSearch, confirm } from '../../../lib/shared/prompts.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { buildAuthSettingsBody, requireAuthPrereqs, pruneEventsForScopes } from '../../../lib/auth/settings.js'
import { followVersionChangeNotes, loadAppContext, versionResult } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppScopesRemove extends GhlCommand {
  static description = 'Remove OAuth scopes from the selected app'

  static examples = ['<%= config.bin %> app scopes remove', '<%= config.bin %> app scopes remove contacts.readonly']

  static enableJsonFlag = true

  static strict = false

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip confirmation when dependent webhooks will be removed', default: false })
  }

  protected async execute(): Promise<unknown> {
    const { argv, flags } = await this.parse(AppScopesRemove)
    const json = this.jsonEnabled()
    const interactive = process.stdin.isTTY === true && !json
    let scopes: string[]
    try {
      scopes = normalizeVariadicArgs(argv as string[], 'scope')
    } catch (error) {
      this.error(errorMessage(error, 'Invalid scope arguments'))
    }
    if (scopes.length === 0 && !interactive) {
      this.error('Pass at least one scope to remove.')
    }

    const context = await loadAppContext(flags.app, json)
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
      if (json) {
        return versionResult(context, { changed: false, scopes: current })
      }
      this.log('None of the given scopes are currently selected.')
      return
    }

    /* Dropping a scope also drops the webhook events it enabled. */
    const catalog = await context.client.getWebhooksCatalog()
    const subscribed = context.version.subscribedEvents ?? []
    const events = pruneEventsForScopes(subscribed, next, catalog)
    const removedEvents = subscribed.length - events.length
    if (removedEvents > 0 && !flags.force) {
      if (!interactive) {
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
    const result = await withSpinner(
      'Saving scopes...',
      () => context.client.updateAuthSettings(context.selected.appId, context.selected.versionId, body),
      { quiet: json }
    )
    if (!json) {
      this.log(`Scopes updated (${next.length} total).`)
      if (removedEvents > 0) {
        this.log(`${removedEvents} webhook event subscription(s) depending on removed scopes were unsubscribed.`)
      }
    }
    const notes = await followVersionChangeNotes(context, result)
    if (!json) {
      for (const note of notes) this.log(note)
      return
    }
    const kept = new Set(events.map(event => event.name))
    const unsubscribedEvents = subscribed.filter(event => !kept.has(event.name)).map(event => event.name)
    const pruned = unsubscribedEvents.length > 0 ? { unsubscribedEvents } : {}
    return versionResult(context, { changed: true, scopes: next, ...pruned }, notes)
  }
}
