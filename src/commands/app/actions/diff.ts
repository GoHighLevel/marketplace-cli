import { Command, Flags } from '@oclif/core'

import { loadWorkflowActionsSyncContext } from '../../../lib/workflows/actions/command-context.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppActionsDiff extends Command {
  static description = 'Compare local workflow actions with the last pull and current portal state'

  static examples = ['<%= config.bin %> app actions diff', '<%= config.bin %> app actions diff --directory ./my-app --json']

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppActionsDiff)
    try {
      const context = await withSpinner(
        'Comparing workflow actions...',
        () => loadWorkflowActionsSyncContext(flags.directory),
        { quiet: this.jsonEnabled() }
      )
      const result = {
        appId: context.appId,
        localChanges: context.plan.localChanges,
        portalChanges: context.plan.remoteChanges,
        conflicts: context.plan.conflicts,
        errors: context.plan.errors,
        operations: context.plan.operations.map(operation => ({ type: operation.type, key: operation.key }))
      }
      if (this.jsonEnabled()) return result
      this.log(`Local changes: ${result.localChanges.length}`)
      for (const change of result.localChanges) this.log(`  local   ${change}`)
      this.log(`Portal changes: ${result.portalChanges.length}`)
      for (const change of result.portalChanges) this.log(`  portal  ${change}`)
      this.log(`Conflicts: ${result.conflicts.length}`)
      for (const conflict of result.conflicts) this.log(`  conflict ${conflict}`)
      for (const error of result.errors) this.log(`  invalid  ${error}`)
      this.log(`API operations: ${result.operations.map(operation => `${operation.type}:${operation.key}`).join(', ') || 'none'}`)
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to compare workflow actions.')
    }
  }
}
