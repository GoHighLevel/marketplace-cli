import { Command, Flags } from '@oclif/core'

import { validateLocalBillingIntent } from '../../../lib/billing/command-context.js'
import { loadBillingWorkspace } from '../../../lib/billing/workspace.js'

export default class AppBillingValidate extends Command {
  static description = 'Validate local subscription and usage billing JSON without calling an API'

  static examples = [
    '<%= config.bin %> app billing validate',
    '<%= config.bin %> app billing validate --directory ./my-app --json'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppBillingValidate)
    try {
      const workspace = await loadBillingWorkspace(flags.directory)
      const errors = await validateLocalBillingIntent(workspace)
      if (errors.length > 0) throw new Error(`Billing configuration is invalid:\n- ${errors.join('\n- ')}`)
      const result = {
        valid: true,
        appId: workspace.app.appId,
        plans: workspace.subscriptions.plans.length,
        meters: workspace.usage.meters.length,
        errors: []
      }
      if (this.jsonEnabled()) return result
      this.log(`Billing configuration is valid (${result.plans} plan(s), ${result.meters} meter(s)).`)
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Billing validation failed.')
    }
  }
}
