import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { applyAppPush, planAppPush } from '../../lib/app/workspace-push.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppPush extends GhlCommand {
  static description = 'Validate and push changed local app sections to the developer portal'

  static examples = [
    '<%= config.bin %> app push',
    '<%= config.bin %> app push --directory ./my-app',
    '<%= config.bin %> app push --directory ./my-app --dry-run --json'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    'dry-run': Flags.boolean({ description: 'Validate and show the API plan without changing remote or local files' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppPush)
    const context = await withSpinner('Validating and planning app push...', () => planAppPush(flags.directory), {
      quiet: this.jsonEnabled()
    })

    if (flags['dry-run']) {
      const result = {
        dryRun: true,
        appId: context.plan.appId,
        versionId: context.plan.versionId,
        sections: context.plan.sections,
        changes: context.plan.localChanges
      }
      if (this.jsonEnabled()) return result
      this.log(`Validation passed. API sections: ${context.plan.sections.join(', ') || 'none'}.`)
      return
    }

    const pushed = await withSpinner('Pushing app changes...', () => applyAppPush(context), {
      quiet: this.jsonEnabled()
    })
    const result = {
      appId: context.plan.appId,
      versionId: pushed.versionId,
      appliedSections: pushed.appliedSections,
      files: pushed.files
    }
    if (this.jsonEnabled()) return result
    if (pushed.appliedSections.length === 0) {
      this.log('No local changes required an API update; local files are synchronized.')
    } else {
      this.log(`Pushed and verified: ${pushed.appliedSections.join(', ')}.`)
    }
  }
}
