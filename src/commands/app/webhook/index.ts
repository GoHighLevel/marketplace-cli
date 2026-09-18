import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { loadAppContext } from '../../../lib/app/section-context.js'

export default class AppWebhook extends GhlCommand {
  static description = 'Show the webhook configuration of the selected app'

  static examples = ['<%= config.bin %> app webhook', '<%= config.bin %> app webhook url https://acme.com/webhooks']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppWebhook)
    const context = await loadAppContext(flags.app, this.jsonEnabled())
    const webhookUrl = context.version.webhookUrl ?? ''
    const events = context.version.subscribedEvents ?? []

    if (this.jsonEnabled()) return { webhookUrl, subscribedEvents: events }

    this.log(`Webhook URL: ${webhookUrl || '- (set one with `ghl app webhook url <url>`)'}`)
    if (events.length === 0) {
      this.log('No subscribed events. See available ones with `ghl app webhook events`.')
      return
    }
    this.log(`${events.length} subscribed event(s):`)
    for (const event of events) this.log(`  ${event.name}${event.url ? `  -> ${event.url}` : ''}`)
  }
}
