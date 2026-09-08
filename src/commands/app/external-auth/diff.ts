import { Command, Flags } from '@oclif/core'

import { loadExternalAuthSyncContext } from '../../../lib/external-auth/command-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppExternalAuthDiff extends Command {
  static description = 'Compare local external-auth JSON with the last pull and current portal state'

  static examples = [
    '<%= config.bin %> app external-auth diff',
    '<%= config.bin %> app external-auth diff --directory ./my-app --json'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppExternalAuthDiff)
    try {
      const context = await withSpinner(
        'Comparing external authentication...',
        () => loadExternalAuthSyncContext(flags.directory),
        { quiet: this.jsonEnabled() }
      )
      const result = {
        appId: context.appId,
        versionId: context.versionId,
        localChanges: context.plan.localChanges,
        portalChanges: context.plan.remoteChanges,
        conflicts: context.plan.conflicts,
        errors: context.plan.errors,
        updateRequired: context.plan.updateRequired
      }
      if (this.jsonEnabled()) {
        if (result.conflicts.length > 0 || result.errors.length > 0) process.exitCode = 1
        return result
      }
      this.log(`Local changes: ${result.localChanges.length}`)
      for (const change of result.localChanges) this.log(`  local    ${change}`)
      this.log(`Portal changes: ${result.portalChanges.length}`)
      for (const change of result.portalChanges) this.log(`  portal   ${change}`)
      for (const conflict of result.conflicts) this.log(`  conflict ${conflict}`)
      for (const error of result.errors) this.log(`  invalid  ${error}`)
      this.log(`API update: ${result.updateRequired ? 'required' : 'none'}`)
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to compare external authentication.')
    }
  }
}
