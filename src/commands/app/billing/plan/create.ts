import { Args, Command, Flags } from '@oclif/core'

import { validateLocalBillingIntent } from '../../../../lib/billing/command-context.js'
import { createBillingPlanScaffold } from '../../../../lib/billing/manifest.js'
import { loadBillingWorkspace, writeLocalBillingWorkspace } from '../../../../lib/billing/workspace.js'
import { parseAmount } from '../../../../lib/billing/pricing.js'
import { input, isPromptCancel, select } from '../../../../lib/shared/prompts.js'

export default class AppBillingPlanCreate extends Command {
  static description = 'Add a subscription plan to local JSON; run billing push to create it remotely'

  static examples = [
    '<%= config.bin %> app billing plan create "Pro" --amount 29.99 --interval month',
    '<%= config.bin %> app billing plan create "Free" --free',
    '<%= config.bin %> app billing plan create "Location" --amount 49 --free-for-location'
  ]

  static enableJsonFlag = true

  static args = {
    name: Args.string({ description: 'Plan name (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    amount: Flags.string({ description: 'Agency price in USD with at most two decimal places' }),
    'location-amount': Flags.string({ description: 'Sub-account price in USD with at most two decimal places' }),
    interval: Flags.string({ description: 'Billing interval', options: ['month', 'year', 'life_time'] }),
    feature: Flags.string({ description: 'Plan feature (repeat up to five times)', multiple: true }),
    free: Flags.boolean({ description: 'Create a fully free freemium plan' }),
    'free-for-agency': Flags.boolean({ description: 'Charge sub-accounts but make agency installs free' }),
    'free-for-location': Flags.boolean({ description: 'Charge agencies but make sub-account installs free' })
  }

  async run(): Promise<unknown> {
    const { args, flags } = await this.parse(AppBillingPlanCreate)
    const interactive = process.stdin.isTTY === true && !this.jsonEnabled()
    if (!args.name && !interactive) this.error('Pass the plan name when running non-interactively.')
    try {
      const workspace = await loadBillingWorkspace(flags.directory)
      if (flags.free && (flags.amount !== undefined || flags['location-amount'] !== undefined)) {
        throw new Error('Do not pass --amount or --location-amount with --free.')
      }
      if (!flags.free && flags['free-for-agency'] && flags['free-for-location']) {
        throw new Error('Use --free for a plan that is free for both agencies and sub-accounts.')
      }
      if (flags['free-for-agency'] && flags.amount !== undefined) {
        throw new Error('Do not pass --amount when --free-for-agency is enabled.')
      }
      if (flags['free-for-location'] && flags['location-amount'] !== undefined) {
        throw new Error('Do not pass --location-amount when --free-for-location is enabled.')
      }
      const name =
        args.name ??
        (await input({
          message: 'Plan name:',
          validate: value => (value.trim() ? true : 'Plan name is required.')
        }))
      const freePlan = flags.free
      const freeForAgency = freePlan || flags['free-for-agency']
      const freeForLocation = freePlan || flags['free-for-location']
      let interval = flags.interval as 'month' | 'year' | 'life_time' | undefined
      if (!interval) {
        interval =
          workspace.app.appType === 'template'
            ? 'life_time'
            : interactive
              ? await select({
                  message: 'Billing interval:',
                  choices: [
                    { name: 'Monthly', value: 'month' as const },
                    { name: 'Yearly', value: 'year' as const },
                    { name: 'One-time', value: 'life_time' as const }
                  ],
                  default: 'month'
                })
              : 'month'
      }
      let amountText = flags.amount
      let locationAmountText = flags['location-amount']
      if (!freeForAgency && amountText === undefined && interactive) {
        amountText = await input({
          message: 'Agency price (USD):',
          validate: value => {
            try {
              return (parseAmount(value, 'Agency amount') ?? 0) >= 0.01 ? true : 'Agency amount must be at least 0.01.'
            } catch (error) {
              return (error as Error).message
            }
          }
        })
      }
      if (freeForAgency && !freePlan && locationAmountText === undefined && interactive) {
        locationAmountText = await input({
          message: 'Sub-account price (USD):',
          validate: value => {
            try {
              return (parseAmount(value, 'Sub-account amount') ?? 0) >= 0.01
                ? true
                : 'Sub-account amount must be at least 0.01.'
            } catch (error) {
              return (error as Error).message
            }
          }
        })
      }
      if (!freeForAgency && amountText === undefined) {
        throw new Error('Agency amount is required unless the plan is free for agencies.')
      }
      if (freeForAgency && !freePlan && locationAmountText === undefined) {
        throw new Error('Location amount is required when the plan is free for agencies.')
      }
      const plan = createBillingPlanScaffold({
        name,
        amount: freeForAgency ? 0 : (parseAmount(amountText, 'Agency amount') as number),
        ...(freePlan
          ? { locationAmount: 0 }
          : locationAmountText !== undefined
            ? { locationAmount: parseAmount(locationAmountText, 'Location amount') as number }
            : {}),
        paymentTime: interval,
        features: flags.feature,
        freePlan,
        freeForAgency,
        freeForLocation
      })
      const subscriptions = structuredClone(workspace.subscriptions)
      subscriptions.plans.push(plan)
      const staged = { ...workspace, subscriptions }
      const errors = await validateLocalBillingIntent(staged)
      if (errors.length > 0) throw new Error(`Subscription plan is invalid:\n- ${errors.join('\n- ')}`)
      const files = await writeLocalBillingWorkspace(workspace.directory, subscriptions, workspace.usage)
      const result = {
        appId: workspace.app.appId,
        name: plan.name,
        subscriptionFile: files.subscriptionFile,
        staged: true
      }
      if (this.jsonEnabled()) return result
      this.log(
        `Added "${plan.name}" to ${files.subscriptionFile}. Run \`ghl app billing push\` to create it in the portal.`
      )
      return
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to stage the subscription plan.')
    }
  }
}
