import { Args, Command, Flags } from '@oclif/core'

import { validateLocalBillingIntent } from '../../../../lib/billing/command-context.js'
import {
  loadBillingWorkspace,
  writeLocalBillingWorkspace
} from '../../../../lib/billing/workspace.js'
import { confirm, isPromptCancel, select } from '../../../../lib/shared/prompts.js'

export default class AppBillingPlanDelete extends Command {
  static description = 'Remove a plan from local JSON; run billing push to delete it remotely'

  static examples = [
    '<%= config.bin %> app billing plan delete planId',
    '<%= config.bin %> app billing plan delete "Pro" --force'
  ]

  static enableJsonFlag = true

  static args = {
    plan: Args.string({ description: 'Plan id or exact name (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    force: Flags.boolean({ description: 'Confirm local removal without prompting' })
  }

  async run(): Promise<unknown> {
    const { args, flags } = await this.parse(AppBillingPlanDelete)
    if (!args.plan && (!process.stdin.isTTY || this.jsonEnabled())) {
      this.error('Pass a plan id or exact name and --force when running non-interactively.')
    }
    try {
      const workspace = await loadBillingWorkspace(flags.directory)
      if (workspace.subscriptions.plans.length === 0) throw new Error('This app has no local subscription plans.')
      const selector = args.plan ?? await select({
        message: 'Subscription plan to remove:',
        choices: workspace.subscriptions.plans.map(plan => ({
          name: `${plan.name} (${plan.id ?? 'new'})`,
          value: plan.id ?? plan.name
        }))
      })
      const index = workspace.subscriptions.plans.findIndex(plan => plan.id === selector || plan.name === selector)
      if (index < 0) throw new Error(`Subscription plan "${selector}" was not found in local JSON.`)
      const plan = workspace.subscriptions.plans[index]
      if (!flags.force) {
        if (!process.stdin.isTTY || this.jsonEnabled()) throw new Error('Pass --force to remove a plan non-interactively.')
        const approved = await confirm({ message: `Remove "${plan.name}" from local JSON?`, default: false })
        if (!approved) {
          this.log('Cancelled — nothing was changed.')
          return
        }
      }
      const subscriptions = structuredClone(workspace.subscriptions)
      subscriptions.plans.splice(index, 1)
      const errors = await validateLocalBillingIntent({ ...workspace, subscriptions })
      if (errors.length > 0) throw new Error(`Plan deletion is invalid:\n- ${errors.join('\n- ')}`)
      const files = await writeLocalBillingWorkspace(workspace.directory, subscriptions, workspace.usage)
      const result = { appId: workspace.app.appId, id: plan.id ?? null, name: plan.name, stagedDeletion: true, files }
      if (this.jsonEnabled()) return result
      this.log(`Removed "${plan.name}" from local JSON. Run \`ghl app billing push --force\` to apply the deletion.`)
      return
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to stage the plan deletion.')
    }
  }
}
