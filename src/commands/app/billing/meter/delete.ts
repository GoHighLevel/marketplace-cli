import { Args, Command, Flags } from '@oclif/core'

import { validateLocalBillingIntent } from '../../../../lib/billing/command-context.js'
import {
  loadBillingWorkspace,
  writeLocalBillingWorkspace
} from '../../../../lib/billing/workspace.js'
import { confirm, isPromptCancel, select } from '../../../../lib/shared/prompts.js'

export default class AppBillingMeterDelete extends Command {
  static description = 'Remove a meter from local JSON; run billing push to delete it remotely'

  static examples = [
    '<%= config.bin %> app billing meter delete meterId',
    '<%= config.bin %> app billing meter delete send_message --force'
  ]

  static enableJsonFlag = true

  static args = {
    meter: Args.string({ description: 'Meter id or product id (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    force: Flags.boolean({ description: 'Confirm local removal without prompting' })
  }

  async run(): Promise<unknown> {
    const { args, flags } = await this.parse(AppBillingMeterDelete)
    if (!args.meter && (!process.stdin.isTTY || this.jsonEnabled())) {
      this.error('Pass a meter id or product id and --force when running non-interactively.')
    }
    try {
      const workspace = await loadBillingWorkspace(flags.directory)
      if (workspace.usage.meters.length === 0) throw new Error('This app has no local usage meters.')
      const selector = args.meter ?? await select({
        message: 'Usage meter to remove:',
        choices: workspace.usage.meters.map(meter => ({
          name: `${meter.productName} (${meter.id ?? meter.productId})`,
          value: meter.id ?? meter.productId
        }))
      })
      const matches = workspace.usage.meters
        .map((meter, index) => ({ meter, index }))
        .filter(item => item.meter.id === selector || item.meter.productId === selector)
      if (matches.length === 0) throw new Error(`Usage meter "${selector}" was not found in local JSON.`)
      if (matches.length > 1) throw new Error(`Product id "${selector}" is ambiguous; pass the meter id instead.`)
      const { meter, index } = matches[0]
      if (!flags.force) {
        if (!process.stdin.isTTY || this.jsonEnabled()) throw new Error('Pass --force to remove a meter non-interactively.')
        const approved = await confirm({ message: `Remove "${meter.productName}" from local JSON?`, default: false })
        if (!approved) {
          this.log('Cancelled — nothing was changed.')
          return
        }
      }
      const usage = structuredClone(workspace.usage)
      usage.meters.splice(index, 1)
      const errors = await validateLocalBillingIntent({ ...workspace, usage })
      if (errors.length > 0) throw new Error(`Meter deletion is invalid:\n- ${errors.join('\n- ')}`)
      const files = await writeLocalBillingWorkspace(workspace.directory, workspace.subscriptions, usage)
      const result = {
        appId: workspace.app.appId,
        id: meter.id ?? null,
        productId: meter.productId,
        stagedDeletion: true,
        files
      }
      if (this.jsonEnabled()) return result
      this.log(`Removed "${meter.productName}" from local JSON. Run \`ghl app billing push --force\` to apply the deletion.`)
      return
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to stage the meter deletion.')
    }
  }
}
