import { Command, Flags } from '@oclif/core'

import { confirm, input, isPromptCancel, select } from '../../../lib/shared/prompts.js'
import {
  MAX_PLANS,
  MAX_PLAN_FEATURES,
  MAX_TEMPLATE_PLANS,
  buildBillingPlan,
  parseAmount,
  requirePricingEditable
} from '../../../lib/billing/pricing.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { validateTextForWhiteLabel } from '../../../lib/shared/validation.js'

export default class AppPricingAdd extends Command {
  static description = 'Add a pricing plan to the selected app'

  static examples = [
    '<%= config.bin %> app pricing add',
    '<%= config.bin %> app pricing add --name "Free Plan" --free',
    '<%= config.bin %> app pricing add --name "Pro" --amount 49 --interval month'
  ]

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    name: Flags.string({ description: 'Plan name' }),
    free: Flags.boolean({ description: 'Create a free plan (freemium apps only)', default: false }),
    amount: Flags.string({ description: 'Price for agencies in USD (up to 2 decimal places)' }),
    'location-amount': Flags.string({ description: 'Optional price for sub-accounts in USD' }),
    feature: Flags.string({ description: `Plan feature (repeat up to ${MAX_PLAN_FEATURES} times)`, multiple: true }),
    interval: Flags.string({
      description: 'Billing interval',
      options: ['month', 'year', 'life_time']
    })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AppPricingAdd)
    const interactive = process.stdin.isTTY

    if (flags.name === undefined && !interactive) {
      this.error('Pass --name (with --free or --amount) when running non-interactively.')
    }
    if (flags.name !== undefined && !flags.free && flags.amount === undefined && !interactive) {
      this.error('Pass --amount for paid plans, or --free for a free plan.')
    }

    try {
      const context = await loadAppContext(flags.app)
      requirePricingEditable(context.version.status)
      const isTemplateApp = context.version.appType === 'template'
      const isWhiteLabelFriendly = context.version.isWhiteLabelFriendly !== false
      const allowLocationPricing = (context.version.userTypes ?? []).length >= 2
      const model = context.version.billingType

      if (context.version.externalBilling) {
        this.error('Pricing plans cannot be added while external billing is enabled.')
      }
      if (model === 'free' || model === undefined) {
        this.error('Set a paid or freemium pricing model first: `ghl app pricing setup`.')
      }

      /* Portal caps: 6 plans, and a single plan for template apps. */
      const plans = await withSpinner('Loading plans...', () => context.client.getBillingPlans(context.selected.appId))
      const maxPlans = isTemplateApp ? MAX_TEMPLATE_PLANS : MAX_PLANS
      if (plans.length >= maxPlans) {
        this.error(
          isTemplateApp
            ? 'Template apps can have only one pricing plan — remove the existing one first.'
            : `An app can have at most ${MAX_PLANS} pricing plans — remove one first with \`ghl app pricing remove\`.`
        )
      }

      let { free } = flags
      let name = flags.name
      let amountText = flags.amount
      let locationAmountText = flags['location-amount']
      let interval = flags.interval as 'month' | 'year' | 'life_time' | undefined
      let features = flags.feature

      if (name === undefined) {
        name = await input({
          message: 'Plan name:',
          validate: value => {
            if (!value.trim()) return 'Plan name is required.'
            return isWhiteLabelFriendly ? validateTextForWhiteLabel(value, 'Plan name') : true
          }
        })

        if (!free && model === 'freemium') {
          free = await confirm({ message: 'Is this a free plan?', default: false })
        }

        if (!free) {
          if (interval === undefined) {
            interval = isTemplateApp
              ? 'life_time'
              : await select({
                  message: 'Billing interval:',
                  choices: [
                    { name: 'Monthly', value: 'month' as const },
                    { name: 'Yearly', value: 'year' as const },
                    { name: 'One-time', value: 'life_time' as const }
                  ],
                  default: 'month'
                })
          }
          if (amountText === undefined) {
            amountText = await input({
              message: allowLocationPricing ? 'Price for agencies (USD):' : 'Price (USD):',
              validate: value => {
                try {
                  const parsed = parseAmount(value, 'Amount')
                  return parsed !== undefined && parsed >= 0.01 ? true : 'Paid plan amount must be at least 0.01.'
                } catch (error) {
                  return error instanceof Error ? error.message : 'Invalid amount'
                }
              }
            })
          }
          if (allowLocationPricing && locationAmountText === undefined) {
            const differs = await confirm({ message: 'Charge sub-accounts a different price?', default: false })
            if (differs) {
              locationAmountText = await input({
                message: 'Price for sub-accounts (USD):',
                validate: value => {
                  try {
                    const parsed = parseAmount(value, 'Location amount')
                    return parsed !== undefined && parsed >= 0.01
                      ? true
                      : 'Paid plan location amount must be at least 0.01.'
                  } catch (error) {
                    return error instanceof Error ? error.message : 'Invalid amount'
                  }
                }
              })
            }
          }
        }

        if (features === undefined) {
          const featureText = await input({
            message: `Plan features (comma-separated, up to ${MAX_PLAN_FEATURES}, optional):`,
            validate: value => {
              const list = value
                .split(',')
                .map(item => item.trim())
                .filter(Boolean)
              if (list.length > MAX_PLAN_FEATURES)
                return `A pricing plan can have at most ${MAX_PLAN_FEATURES} features.`
              if (isWhiteLabelFriendly) {
                for (const feature of list) {
                  const check = validateTextForWhiteLabel(feature, `Feature "${feature}"`)
                  if (check !== true) return check
                }
              }
              return true
            }
          })
          features = featureText
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
        }
      }

      if (!free && amountText === undefined) {
        this.error('Pass --amount for paid plans, or --free for a free plan.')
      }

      let body
      try {
        body = buildBillingPlan({
          name,
          free,
          amount: parseAmount(amountText, 'Agency amount'),
          locationAmount: parseAmount(locationAmountText, 'Location amount'),
          interval: interval ?? (isTemplateApp ? 'life_time' : 'month'),
          features,
          model,
          isTemplateApp,
          isWhiteLabelFriendly,
          allowLocationPricing
        })
      } catch (error) {
        this.error(error instanceof Error ? error.message : 'Invalid pricing plan')
      }

      await withSpinner('Adding plan...', () => context.client.addBillingPlan(context.selected.appId, body))
      this.log(`Plan "${body.name}" added.`)
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to add plan')
    }
  }
}
