import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { errorMessage } from '../../../lib/shared/errors.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { eventsAllowedByScopes, mergeEventSubscriptions } from '../../../lib/auth/settings.js'
import { checkboxSearch, input } from '../../../lib/shared/prompts.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { validateHttpsUrl } from '../../../lib/shared/validation.js'
import {
  applyWebhookWorkspaceMutation,
  loadWebhookWorkspaceMutationContext,
  webhookWorkspaceFlags
} from '../../../lib/webhooks/workspace-mutation.js'

export default class AppWebhookSubscribe extends GhlCommand {
  static description = 'Subscribe a local app workspace to webhook events and synchronize it'

  static examples = [
    '<%= config.bin %> app webhook subscribe ContactCreate ContactUpdate',
    '<%= config.bin %> app webhook subscribe ContactCreate --url https://acme.com/contact-hook',
    '<%= config.bin %> app webhook subscribe ContactCreate --directory ./my-app'
  ]

  static strict = false

  static flags = {
    ...webhookWorkspaceFlags(),
    url: Flags.string({ description: 'Per-event override URL (default: the app webhook URL)' })
  }

  protected async execute(): Promise<void> {
    const { argv, flags } = await this.parse(AppWebhookSubscribe)
    let names: string[]
    try {
      names = normalizeVariadicArgs(argv as string[], 'event name')
    } catch (error) {
      this.error(errorMessage(error, 'Invalid event arguments'))
    }
    const interactive = process.stdin.isTTY
    if (names.length === 0 && !interactive) {
      this.error('Pass at least one event name — see `ghl app webhook events`.')
    }
    const overrideUrl = flags.url?.trim()
    if (flags.url !== undefined) {
      const validation = validateHttpsUrl(overrideUrl ?? '', 'Per-event webhook URL', { publicOnly: true })
      if (validation !== true) this.error(validation)
    }

    const context = await withSpinner('Loading webhook workspace...', () =>
      loadWebhookWorkspaceMutationContext(flags.directory, flags.app)
    )

    const catalog = await context.client.getWebhooksCatalog()
    context.webhooksCatalog = catalog
    const allowed = new Set(eventsAllowedByScopes(context.remoteFiles.app.oauth.allowedScopes, catalog))

    const current = context.remoteFiles.webhooks.subscribedEvents

    if (names.length === 0) {
      const subscribed = new Set(current.map(event => event.name))
      const available = [...allowed].filter(name => !subscribed.has(name)).sort()
      if (available.length === 0) {
        this.error(
          allowed.size === 0
            ? 'No webhook events are unlocked by the current scopes — add scopes first with `ghl app scopes add`.'
            : 'All events unlocked by the current scopes are already subscribed.'
        )
      }
      names = await checkboxSearch({
        message: 'Which events should be subscribed?',
        choices: available.map(name => ({ name, value: name })),
        validate: choices => (choices.length > 0 ? true : 'Select at least one event.')
      })
    }

    const notAllowed = names.filter(name => !allowed.has(name))
    if (notAllowed.length > 0) {
      this.error(
        `Not available with the current scopes: ${notAllowed.join(', ')}. ` +
          'Run `ghl app webhook events` to see what your scopes unlock.'
      )
    }

    /* The portal requires a default webhook URL even when every selected
       event has a custom override, so collect it before the shared save. */
    let webhookUrl: string | undefined
    if (!context.remoteFiles.webhooks.webhookUrl) {
      if (!interactive) {
        this.error('Set a default webhook URL first with `ghl app webhook url <url>`.')
      }
      webhookUrl = (
        await input({
          message: 'This app has no default webhook URL yet — enter one (https):',
          validate: value => validateHttpsUrl(value, 'Webhook URL', { publicOnly: true })
        })
      ).trim()
    }

    const merged = mergeEventSubscriptions(current, names, overrideUrl)
    const result = await withSpinner('Saving local and remote event subscriptions...', () =>
      applyWebhookWorkspaceMutation(context, {
        webhookUrl: webhookUrl ?? context.remoteFiles.webhooks.webhookUrl,
        subscribedEvents: merged.events
      })
    )
    if (!result.applied) {
      this.log('All given events are already subscribed; local workspace synchronized.')
      return
    }
    this.log(
      `Webhook subscriptions saved: ${merged.added} added, ${merged.updated} URL override(s) updated ` +
        `(${merged.events.length} total); local workspace synchronized.`
    )
  }
}
