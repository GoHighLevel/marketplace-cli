import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../../lib/shared/command.js'
import { loadBillingWorkspace } from '../../../../lib/billing/workspace.js'
import { renderTable } from '../../../../lib/shared/table.js'

export default class AppBillingPlan extends GhlCommand {
  static description = 'List subscription plans in the local app workspace'

  static examples = ['<%= config.bin %> app billing plan', '<%= config.bin %> app billing plan --json']

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppBillingPlan)
    const workspace = await loadBillingWorkspace(flags.directory)
    const result = { appId: workspace.app.appId, plans: workspace.subscriptions.plans }
    if (this.jsonEnabled()) return result
    if (result.plans.length === 0) {
      this.log('No local subscription plans. Create one with `ghl app billing plan create`.')
      return
    }
    this.log(
      renderTable(
        ['PLAN ID', 'NAME', 'PRICE', 'INTERVAL'],
        result.plans.map(plan => [
          plan.id ?? '(new)',
          plan.name,
          plan.freePlan ? 'free' : String(plan.amount),
          plan.paymentTime
        ])
      )
    )
  }
}
