import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { eventsAllowedByScopes } from '../../../lib/auth/settings.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppWebhookEvents extends GhlCommand {
  static description = 'List webhook events available to the selected app (based on its scopes)'

  static examples = ['<%= config.bin %> app webhook events']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppWebhookEvents)
    const context = await loadAppContext(flags.app, this.jsonEnabled())
    const catalog = await withSpinner('Loading event catalog...', () => context.client.getWebhooksCatalog(), {
      quiet: this.jsonEnabled()
    })

    const available = [...new Set(eventsAllowedByScopes(context.version.allowedScopes ?? [], catalog))]
    const subscribed = new Set((context.version.subscribedEvents ?? []).map(event => event.name))

    if (this.jsonEnabled()) return { available, subscribed: [...subscribed] }

    if (available.length === 0) {
      this.log('No events available — events are unlocked by scopes. Add scopes first (`ghl app scopes add`).')
      return
    }
    this.log(`${available.length} event(s) available for your scopes ([x] = subscribed):`)
    for (const name of available.sort()) {
      this.log(`  ${subscribed.has(name) ? '[x]' : '[ ]'} ${name}`)
    }
  }
}
