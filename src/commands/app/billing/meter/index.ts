import { Command, Flags } from '@oclif/core'

import { loadBillingWorkspace } from '../../../../lib/billing/workspace.js'
import { renderTable } from '../../../../lib/shared/table.js'

export default class AppBillingMeter extends Command {
  static description = 'List usage meters in the local app workspace'

  static examples = ['<%= config.bin %> app billing meter', '<%= config.bin %> app billing meter --json']

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppBillingMeter)
    try {
      const workspace = await loadBillingWorkspace(flags.directory)
      const result = { appId: workspace.app.appId, meters: workspace.usage.meters }
      if (this.jsonEnabled()) return result
      if (result.meters.length === 0) {
        this.log('No local usage meters. Create one with `ghl app billing meter create`.')
        return
      }
      this.log(renderTable(
        ['METER ID', 'PRODUCT', 'TYPE', 'TIERS'],
        result.meters.map(meter => [meter.id ?? '(new)', meter.productName, meter.productType, String(meter.tiers.length)])
      ))
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to list local usage meters.')
    }
  }
}
