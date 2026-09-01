import { Command, Flags } from '@oclif/core'

import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppPricing extends Command {
  static description = 'Show the pricing configuration and plans of the selected app'

  static examples = ['<%= config.bin %> app pricing', '<%= config.bin %> app pricing setup --model free']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppPricing)
    try {
      const context = await loadAppContext(flags.app, this.jsonEnabled())
      const plans = await withSpinner('Loading plans...', () => context.client.getBillingPlans(context.selected.appId), {
        quiet: this.jsonEnabled()
      })
      const settings = {
        billingType: context.version.billingType ?? null,
        externalBilling: context.version.externalBilling ?? false,
        externalBillingUrl: context.version.externalBillingUrl ?? '',
        hasFreeTrial: context.version.hasFreeTrial ?? false,
        freeTrialDuration: context.version.freeTrialDuration ?? null
      }

      if (this.jsonEnabled()) return { settings, plans }

      this.log(`Pricing model: ${settings.billingType ?? '- (not configured)'}`)
      if (settings.externalBilling) this.log(`External billing URL: ${settings.externalBillingUrl}`)
      if (settings.hasFreeTrial) this.log(`Free trial: ${settings.freeTrialDuration ?? '-'} day(s)`)

      if (plans.length === 0) {
        this.log('No pricing plans. Configure with `ghl app pricing setup` and `ghl app pricing add`.')
        return
      }
      this.log(`${plans.length} plan(s):`)
      for (const plan of plans) {
        const id = plan._id ?? plan.id ?? ''
        const free = plan.isFreemiumPlan ?? plan.freePlan ?? false
        const amount = plan.price ?? plan.amount ?? 0
        const price = free ? 'free' : `$${amount}/${plan.paymentTime ?? ''}`
        this.log(`  ${id}  ${plan.name ?? ''}  ${price}`)
      }
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to load pricing')
    }
  }
}
