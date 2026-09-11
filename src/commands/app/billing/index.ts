import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { loadBillingRemoteContext } from '../../../lib/billing/command-context.js'
import { fetchBillingSnapshot } from '../../../lib/billing/service.js'
import { withSpinner } from '../../../lib/shared/spinner.js'
import { renderTable } from '../../../lib/shared/table.js'

export default class AppBilling extends GhlCommand {
  static description = 'Show subscription plans and usage meters registered for an app'

  static examples = [
    '<%= config.bin %> app billing',
    '<%= config.bin %> app billing --app 67ee6752f753647b1c9ae06e --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the current workspace or selected app)' }),
    directory: Flags.string({ description: 'App workspace directory used to resolve the app id', default: '.' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppBilling)
    const context = await loadBillingRemoteContext({ appId: flags.app, directory: flags.directory })
    const [snapshot, version] = await withSpinner(
      'Loading billing configuration...',
      () =>
        Promise.all([
          fetchBillingSnapshot(context.client, context.appId),
          context.versionId
            ? context.client.getVersion(context.appId, context.versionId)
            : context.client.getLatestVersion(context.appId)
        ]),
      { quiet: this.jsonEnabled() }
    )
    const settings = {
      billingType: version.billingType ?? 'free',
      externalBilling: version.externalBilling ?? false,
      externalBillingUrl: version.externalBillingUrl ?? '',
      hasFreeTrial: version.hasFreeTrial ?? false,
      freeTrialDuration: version.freeTrialDuration ?? null
    }
    if (this.jsonEnabled()) return { appId: context.appId, settings, ...snapshot }
    this.log(`Billing model: ${settings.billingType}`)
    this.log(`Subscription plans: ${snapshot.subscriptions.plans.length}`)
    if (snapshot.subscriptions.plans.length > 0) {
      this.log(
        renderTable(
          ['PLAN ID', 'NAME', 'PRICE', 'INTERVAL'],
          snapshot.subscriptions.plans.map(plan => [
            plan.id ?? '',
            plan.name,
            plan.freePlan ? 'free' : String(plan.amount),
            plan.paymentTime
          ])
        )
      )
    }
    this.log(`Usage meters: ${snapshot.usage.meters.length}`)
    if (snapshot.usage.meters.length > 0) {
      this.log(
        renderTable(
          ['METER ID', 'PRODUCT', 'TYPE', 'TIERS'],
          snapshot.usage.meters.map(meter => [
            meter.id ?? '',
            meter.productName,
            meter.productType,
            String(meter.tiers.length)
          ])
        )
      )
    }
  }
}
