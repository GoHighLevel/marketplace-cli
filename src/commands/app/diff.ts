import { Command, Flags } from '@oclif/core'

import { sanitizeTerminalText } from '../../lib/api/response.js'
import { loadRemoteAppSyncContext } from '../../lib/app/sync-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppDiff extends Command {
  static description = 'Compare local app JSON with the developer portal without changing either side'

  static examples = ['<%= config.bin %> app diff', '<%= config.bin %> app diff --directory ./my-app --json']

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppDiff)
    try {
      const { local, plan } = await withSpinner(
        'Comparing local and remote app...',
        () => loadRemoteAppSyncContext(flags.directory),
        { quiet: this.jsonEnabled() }
      )
      const result = {
        appId: plan.appId,
        versionId: plan.versionId,
        directory: local.directory,
        sections: plan.sections,
        localChanges: plan.localChanges,
        remoteChanges: plan.remoteChanges,
        conflicts: plan.conflicts
      }
      if (this.jsonEnabled()) {
        if (plan.conflicts.length > 0) process.exitCode = 1
        return result
      }
      if (plan.localChanges.length === 0 && plan.remoteChanges.length === 0 && plan.conflicts.length === 0) {
        this.log('Local app configuration matches the developer portal.')
        return
      }
      for (const change of plan.localChanges)
        this.log(`  local    ${sanitizeTerminalText(change.path)} -> ${change.section}`)
      for (const change of plan.remoteChanges) this.log(`  remote   ${sanitizeTerminalText(change.path)}`)
      for (const change of plan.conflicts) this.log(`  conflict ${sanitizeTerminalText(change.path)}`)
      this.log(`API sections required by local changes: ${plan.sections.join(', ') || 'none'}.`)
      if (plan.conflicts.length > 0) {
        this.error('Resolve conflicts by pulling the portal version, then reapply the local changes.')
      }
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to compare the app workspace.')
    }
  }
}
