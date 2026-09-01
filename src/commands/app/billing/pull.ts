import { Command, Flags } from '@oclif/core'

import { readPullWorkspaceBinding } from '../../../lib/app/pull.js'
import { loadBillingRemoteContext } from '../../../lib/billing/command-context.js'
import { fetchBillingSnapshot } from '../../../lib/billing/service.js'
import {
  synchronizeUsageBillingSummary,
  writeBillingWorkspace
} from '../../../lib/billing/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppBillingPull extends Command {
  static description = 'Pull subscription plans and usage meters into local billing JSON files'

  static examples = [
    '<%= config.bin %> app billing pull',
    '<%= config.bin %> app billing pull --directory ./my-app --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id; must match the workspace app' }),
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppBillingPull)
    try {
      const binding = await readPullWorkspaceBinding(flags.directory)
      if (!binding) throw new Error('No ghl-app.json was found. Run this command inside an app workspace or pass --directory.')
      const context = await loadBillingRemoteContext({
        appId: flags.app,
        directory: binding.directory,
        requireWorkspaceMatch: true
      })
      const snapshot = await withSpinner(
        'Pulling billing configuration...',
        () => fetchBillingSnapshot(context.client, context.appId),
        { quiet: this.jsonEnabled() }
      )
      const files = await writeBillingWorkspace(
        binding.directory,
        snapshot.subscriptions,
        snapshot.usage
      )
      await synchronizeUsageBillingSummary(binding.directory, snapshot.usage.meters.length > 0)
      const result = {
        appId: context.appId,
        plans: snapshot.subscriptions.plans.length,
        meters: snapshot.usage.meters.length,
        files
      }
      if (this.jsonEnabled()) return result
      this.log(`Pulled ${result.plans} subscription plan(s) and ${result.meters} usage meter(s).`)
      if (files.subscriptionFile) this.log(`  Plans:  ${files.subscriptionFile}`)
      if (files.usageFile) this.log(`  Meters: ${files.usageFile}`)
      if (!files.subscriptionFile && !files.usageFile) this.log('No billing source directory was created.')
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to pull billing configuration.')
    }
  }
}
