import { Args } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { input } from '../../../lib/shared/prompts.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { validateHttpsUrl } from '../../../lib/shared/validation.js'
import {
  applyWebhookWorkspaceMutation,
  loadWebhookWorkspaceMutationContext,
  webhookWorkspaceFlags
} from '../../../lib/webhooks/workspace-mutation.js'

export default class AppWebhookUrl extends GhlCommand {
  static description = 'Set the webhook URL in a local app workspace and synchronize it'

  static examples = [
    '<%= config.bin %> app webhook url',
    '<%= config.bin %> app webhook url https://acme.com/webhooks',
    '<%= config.bin %> app webhook url https://acme.com/webhooks --directory ./my-app'
  ]

  static args = {
    url: Args.string({ description: 'Webhook URL (https; prompted interactively when omitted)' })
  }

  static flags = webhookWorkspaceFlags()

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parse(AppWebhookUrl)

    if (args.url === undefined && !process.stdin.isTTY) {
      this.error(
        'Pass the webhook URL when running non-interactively, e.g. `ghl app webhook url https://acme.com/webhooks`.'
      )
    }
    const providedUrl = args.url?.trim()
    if (args.url !== undefined) {
      const validation = validateHttpsUrl(providedUrl ?? '', 'Webhook URL', { publicOnly: true })
      if (validation !== true) this.error(validation)
    }

    const context = await withSpinner('Loading webhook workspace...', () =>
      loadWebhookWorkspaceMutationContext(flags.directory, flags.app)
    )

    const url =
      providedUrl ??
      (
        await input({
          message: 'Webhook URL (https):',
          default: context.remoteFiles.webhooks.webhookUrl,
          validate: value => validateHttpsUrl(value, 'Webhook URL', { publicOnly: true })
        })
      ).trim()
    const validation = validateHttpsUrl(url, 'Webhook URL', { publicOnly: true })
    if (validation !== true) this.error(validation)

    const result = await withSpinner('Saving local and remote webhook URL...', () =>
      applyWebhookWorkspaceMutation(context, {
        webhookUrl: url,
        subscribedEvents: context.remoteFiles.webhooks.subscribedEvents
      })
    )
    this.log(
      result.applied
        ? `Webhook URL set to ${url}; local workspace synchronized.`
        : `Webhook URL already set to ${url}; local workspace synchronized.`
    )
  }
}
