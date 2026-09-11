import { Command, Flags } from '@oclif/core'

import { confirm, input, isPromptCancel, select } from '../../../lib/shared/prompts.js'
import { type BillingSettings } from '../../../lib/api/client.js'
import {
  buildBillingSettings,
  defaultFreePlan,
  isFreePlanEntry,
  requirePricingEditable
} from '../../../lib/billing/pricing.js'
import { loadAppContext } from '../../../lib/app/section-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { validateHttpsUrl, validatePositiveInteger } from '../../../lib/shared/validation.js'

export default class AppPricingSetup extends Command {
  static description = 'Configure the pricing model of the selected app'

  static examples = [
    '<%= config.bin %> app pricing setup',
    '<%= config.bin %> app pricing setup --model free',
    '<%= config.bin %> app pricing setup --model paid --trial-days 14'
  ]

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    model: Flags.string({
      description: 'Business model',
      options: ['free', 'paid', 'freemium']
    }),
    'external-billing-url': Flags.string({ description: 'Public HTTPS external billing URL (paid apps only)' }),
    'trial-days': Flags.integer({ description: 'Free trial duration in days (1-90)' }),
    force: Flags.boolean({ description: 'Skip confirmation when free plans must be deleted', default: false })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AppPricingSetup)

    if (flags.model === undefined && !process.stdin.isTTY) {
      this.error('Pass --model (free, paid, or freemium) when running non-interactively.')
    }

    try {
      const context = await loadAppContext(flags.app)
      requirePricingEditable(context.version.status)
      const isTemplateApp = context.version.appType === 'template'

      let model = flags.model as BillingSettings['billingType'] | undefined
      let externalBillingUrl = flags['external-billing-url']
      let trialDays = flags['trial-days']

      if (model === undefined) {
        model = await select({
          message: 'Business model:',
          choices: [
            { name: 'Free', value: 'free' as const },
            { name: 'Paid', value: 'paid' as const },
            ...(isTemplateApp ? [] : [{ name: 'Freemium (free + paid plans)', value: 'freemium' as const }])
          ],
          default: context.version.billingType ?? 'free'
        })

        if (model === 'paid' && !isTemplateApp && externalBillingUrl === undefined) {
          const useExternal = await confirm({
            message: 'Use an external billing page instead of marketplace plans?',
            default: Boolean(context.version.externalBilling)
          })
          if (useExternal) {
            externalBillingUrl = await input({
              message: 'External billing URL (https):',
              default: context.version.externalBillingUrl
                ? `https://${context.version.externalBillingUrl.replace(/^https:\/\//, '')}`
                : '',
              validate: value => validateHttpsUrl(value, 'External billing URL', { publicOnly: true })
            })
          }
        }

        if (model !== 'free' && !isTemplateApp && !externalBillingUrl && trialDays === undefined) {
          const wantsTrial = await confirm({
            message: 'Offer a free trial?',
            default: Boolean(context.version.hasFreeTrial)
          })
          if (wantsTrial) {
            const days = await input({
              message: 'Trial duration in days (1-90):',
              default: String(context.version.freeTrialDuration ?? 14),
              validate: value => {
                const parsed = Number(value)
                return validatePositiveInteger(parsed, 'Trial days', { min: 1, max: 90 })
              }
            })
            trialDays = Number(days)
          }
        }
      }

      let body: BillingSettings
      try {
        body = buildBillingSettings({
          model,
          externalBillingUrl,
          trialDays,
          isTemplateApp,
          createdAt: context.version.createdAt
        })
      } catch (error) {
        this.error(error instanceof Error ? error.message : 'Invalid pricing configuration')
      }

      /* The portal blocks paid apps that still have free plans: it asks for
         confirmation, deletes them all, then saves the new model. */
      const plans = await withSpinner('Loading plans...', () => context.client.getBillingPlans(context.selected.appId))
      const freePlans = plans.filter(plan => isFreePlanEntry(plan))
      let deletedFreePlans = false
      if (model === 'paid' && freePlans.length > 0) {
        if (!flags.force) {
          if (!process.stdin.isTTY) {
            this.error(
              `Switching to paid deletes ${freePlans.length} free plan(s) — pass --force when running non-interactively.`
            )
          }
          const ok = await confirm({
            message: `Switching to paid will delete ${freePlans.length} free plan(s). Continue?`,
            default: false
          })
          if (!ok) return
        }
        await withSpinner('Deleting free plans...', () => context.client.deleteAllFreePlans(context.selected.appId))
        deletedFreePlans = true
      }

      /* The portal auto-creates a default free plan when switching to
         freemium so the model is immediately valid. */
      let createdDefaultPlan = false
      if (model === 'freemium' && freePlans.length === 0) {
        await withSpinner('Creating the default free plan...', () =>
          context.client.addBillingPlan(context.selected.appId, defaultFreePlan(isTemplateApp))
        )
        createdDefaultPlan = true
        this.log('A default "Free Plan" was created — edit or extend it with `ghl app pricing add`.')
      }

      try {
        await withSpinner('Saving pricing configuration...', () =>
          context.client.updateBillingSettings(context.selected.appId, body)
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Pricing configuration could not be saved.'
        if (deletedFreePlans) {
          throw new Error(
            `${message} The free plans were already deleted, but the paid model was not saved; review pricing before retrying.`
          )
        }
        if (createdDefaultPlan) {
          throw new Error(
            `${message} The default free plan was created, but the freemium model was not saved; review pricing before retrying.`
          )
        }
        throw error
      }
      this.log(`Pricing model set to ${model}.`)

      if (model !== 'free' && !body.externalBilling) {
        this.log('Add plans with `ghl app pricing add` — paid plans may require a connected Stripe account.')
      }
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to save pricing configuration')
    }
  }
}
