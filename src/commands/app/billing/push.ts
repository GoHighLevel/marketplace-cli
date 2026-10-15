import { Flags } from '@oclif/core'

import { GhlCommand } from '../../../lib/shared/command.js'
import { applyBillingPush, planBillingPush } from '../../../lib/billing/push.js'
import { confirm } from '../../../lib/shared/prompts.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppBillingPush extends GhlCommand {
  static description = 'Validate and independently push changed subscription plans and usage meters'

  static examples = [
    '<%= config.bin %> app billing push',
    '<%= config.bin %> app billing push --dry-run --json',
    '<%= config.bin %> app billing push --force'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    'dry-run': Flags.boolean({ description: 'Validate and show the API plan without changing remote or local files' }),
    force: Flags.boolean({ description: 'Confirm billing deletions without prompting' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppBillingPush)
    const { context, operations: operationLabels } = await withSpinner(
      'Validating and planning billing push...',
      () => planBillingPush(flags.directory),
      { quiet: this.jsonEnabled() }
    )
    const deletions = operationLabels.filter(label => label.startsWith('delete-'))
    if (!flags['dry-run'] && deletions.length > 0 && !flags.force) {
      if (!process.stdin.isTTY || this.jsonEnabled()) {
        throw new Error('Billing deletions require --force when running non-interactively.')
      }
      const approved = await confirm({
        message: `Apply ${deletions.length} billing deletion(s)?`,
        default: false
      })
      if (!approved) {
        this.log('Cancelled — nothing was changed.')
        return
      }
    }
    if (flags['dry-run']) {
      const result = { dryRun: true, appId: context.appId, operations: operationLabels }
      if (this.jsonEnabled()) return result
      this.log(`Validation passed. API operations: ${operationLabels.join(', ') || 'none'}.`)
      return
    }

    const { execution, files } = await withSpinner(
      'Pushing billing configuration...',
      () => applyBillingPush(context),
      { quiet: this.jsonEnabled() }
    )
    const result = { appId: context.appId, ...execution, files }
    if (execution.failed > 0) process.exitCode = 1
    if (this.jsonEnabled()) return result
    if (execution.total === 0) {
      this.log('No billing API updates were required; local files are synchronized.')
      return
    }
    this.log(`Billing push complete: ${execution.succeeded} succeeded, ${execution.failed} failed.`)
    for (const item of execution.results) {
      this.log(`  ${item.success ? 'succeeded' : 'failed'}  ${item.operation}${item.error ? ` — ${item.error}` : ''}`)
    }
  }
}
