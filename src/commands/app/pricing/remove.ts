import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { confirm, select } from '../../../lib/shared/prompts.js'
import { requirePricingEditable } from '../../../lib/billing/pricing.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppPricingRemove extends GhlCommand {
  static description = 'Remove a pricing plan from the selected app'

  static examples = ['<%= config.bin %> app pricing remove', '<%= config.bin %> app pricing remove <planId> --force']

  static args = {
    planId: Args.string({ description: 'Plan id to remove (picked interactively when omitted)' })
  }

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    force: Flags.boolean({ description: 'Skip the confirmation prompt', default: false })
  }

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parse(AppPricingRemove)

    if (args.planId === undefined && !process.stdin.isTTY) {
      this.error(
        'Pass the plan id when running non-interactively, e.g. `ghl app pricing remove <planId>` (see `ghl app pricing`).'
      )
    }

    const context = await loadAppContext(flags.app)
    requirePricingEditable(context.version.status)
    const plans = await withSpinner('Loading plans...', () => context.client.getBillingPlans(context.selected.appId))

    const planId =
      args.planId ??
      (await (async () => {
        if (plans.length === 0) this.error('This app has no pricing plans to remove.')
        return select({
          message: 'Which pricing plan should be removed?',
          choices: plans.map(plan => {
            const free = plan.freePlan ?? plan.isFreemiumPlan ?? (plan.freeForAgency && plan.freeForLocation)
            const price = plan.amount ?? plan.price
            return {
              name: `${plan.name ?? 'unnamed'} — ${free ? 'free' : `$${price ?? '?'}/${plan.paymentTime ?? '?'}`} (${plan._id ?? plan.id})`,
              value: (plan._id ?? plan.id) as string
            }
          })
        })
      })())

    if (!plans.some(plan => (plan._id ?? plan.id) === planId)) {
      this.error(`Pricing plan "${planId}" was not found on the selected app.`)
    }
    if (!flags.force) {
      if (!process.stdin.isTTY) {
        this.error('Removing a plan affects future installs — pass --force when running non-interactively.')
      }
      const ok = await confirm({ message: `Remove plan ${planId}?`, default: false })
      if (!ok) return
    }
    await withSpinner('Removing plan...', () => context.client.deleteBillingPlan(context.selected.appId, planId))
    this.log(`Plan ${planId} removed.`)
  }
}
