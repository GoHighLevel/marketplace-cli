import { GhlCommand } from '../../../lib/shared/command.js'
import { errorMessage } from '../../../lib/shared/errors.js'
import { normalizeVariadicArgs } from '../../../lib/shared/arguments.js'
import { checkboxSearch } from '../../../lib/shared/prompts.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import {
  applyWebhookWorkspaceMutation,
  loadWebhookWorkspaceMutationContext,
  webhookWorkspaceFlags
} from '../../../lib/webhooks/workspace-mutation.js'

export default class AppWebhookUnsubscribe extends GhlCommand {
  static description = 'Unsubscribe a local app workspace from webhook events and synchronize it'

  static examples = [
    '<%= config.bin %> app webhook unsubscribe',
    '<%= config.bin %> app webhook unsubscribe ContactUpdate',
    '<%= config.bin %> app webhook unsubscribe ContactUpdate --directory ./my-app'
  ]

  static strict = false

  static flags = webhookWorkspaceFlags()

  protected async execute(): Promise<void> {
    const { argv, flags } = await this.parse(AppWebhookUnsubscribe)
    let names: string[]
    try {
      names = normalizeVariadicArgs(argv as string[], 'event name')
    } catch (error) {
      this.error(errorMessage(error, 'Invalid event arguments'))
    }
    if (names.length === 0 && !process.stdin.isTTY) {
      this.error('Pass at least one event name to unsubscribe, e.g. `ghl app webhook unsubscribe ContactUpdate`.')
    }

    const context = await withSpinner('Loading webhook workspace...', () =>
      loadWebhookWorkspaceMutationContext(flags.directory, flags.app)
    )
    const current = context.remoteFiles.webhooks.subscribedEvents

    if (names.length === 0) {
      if (current.length === 0) this.error('This app has no webhook event subscriptions.')
      names = await checkboxSearch({
        message: 'Which events should be unsubscribed?',
        choices: current.map(event => ({ name: event.name, value: event.name })),
        validate: choices => (choices.length > 0 ? true : 'Select at least one event.')
      })
    }

    const next = current.filter(event => !names.includes(event.name))
    const result = await withSpinner('Saving local and remote event subscriptions...', () =>
      applyWebhookWorkspaceMutation(context, {
        webhookUrl: context.remoteFiles.webhooks.webhookUrl,
        subscribedEvents: next
      })
    )
    if (!result.applied) {
      this.log('None of the given events are currently subscribed; local workspace synchronized.')
      return
    }
    this.log(
      `Unsubscribed ${current.length - next.length} event(s) ` +
        `(${next.length} remaining); local workspace synchronized.`
    )
  }
}
