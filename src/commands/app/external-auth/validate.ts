import { Command, Flags } from '@oclif/core'

import { loadExternalAuthWorkspace } from '../../../lib/external-auth/workspace.js'

export default class AppExternalAuthValidate extends Command {
  static description = 'Validate local external-auth JSON without calling an API'

  static examples = [
    '<%= config.bin %> app external-auth validate',
    '<%= config.bin %> app external-auth validate --directory ./my-app --json'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppExternalAuthValidate)
    try {
      const workspace = await loadExternalAuthWorkspace(flags.directory)
      const result = {
        valid: true,
        appId: workspace.app.appId,
        versionId: workspace.app.versionId,
        type: workspace.manifest.type,
        enabled: workspace.manifest.enabled,
        errors: []
      }
      if (this.jsonEnabled()) return result
      this.log(`External auth configuration is valid (${result.type}, ${result.enabled ? 'enabled' : 'disabled'}).`)
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'External auth validation failed.')
    }
  }
}
