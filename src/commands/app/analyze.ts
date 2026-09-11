import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { requireVersionStatus } from '../../lib/app/rules.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppAnalyze extends GhlCommand {
  static description = 'Analyze the draft version and suggest the next version number'

  static examples = ['<%= config.bin %> app analyze']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppAnalyze)
    const context = await loadAppContext(flags.app, this.jsonEnabled())
    requireVersionStatus(context.version.status, ['draft', 'disapproved'], 'analyze')
    const analysis = await withSpinner(
      'Analyzing version...',
      () => context.client.analyzeVersion(context.selected.appId, context.selected.versionId),
      { quiet: this.jsonEnabled() }
    )

    if (this.jsonEnabled()) return analysis

    this.log(`Latest live version: ${analysis.latestLiveVersion ?? '- (none yet)'}`)
    this.log(`Suggested version:   ${analysis.suggestedVersion ?? '-'}`)
    if (analysis.suggestedVersion) {
      this.log(`\nPublish with: ghl app publish --version ${analysis.suggestedVersion} --agency-notes "..."`)
    }
  }
}
