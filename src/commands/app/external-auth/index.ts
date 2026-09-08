import { Command, Flags } from '@oclif/core'

import { loadExternalAuthRemoteContext } from '../../../lib/external-auth/command-context.js'
import { fetchExternalAuthSnapshot, resolveExternalAuthLocks } from '../../../lib/external-auth/service.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppExternalAuth extends Command {
  static description = 'Show the redacted external-auth configuration for an app version'

  static examples = [
    '<%= config.bin %> app external-auth',
    '<%= config.bin %> app external-auth --app 67ee6752f753647b1c9ae06e --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the current workspace or selected app)' }),
    directory: Flags.string({ description: 'App workspace directory used to resolve the app and version', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppExternalAuth)
    try {
      const context = await loadExternalAuthRemoteContext({ appId: flags.app, directory: flags.directory })
      const snapshot = await withSpinner(
        'Loading external authentication...',
        () => fetchExternalAuthSnapshot(context.client, context.appId, context.versionId),
        { quiet: this.jsonEnabled() }
      )
      const locks = await resolveExternalAuthLocks(context.client, context.appId, {
        versionId: context.versionId,
        response: snapshot.raw
      })
      const result = { manifest: snapshot.manifest, locks }
      if (this.jsonEnabled()) return result
      this.log(`External authentication: ${snapshot.manifest.enabled ? 'enabled' : 'disabled'}`)
      this.log(`Type: ${snapshot.manifest.type === 'oauth2' ? 'OAuth 2' : 'Basic'}`)
      this.log(`Installation fields: ${snapshot.manifest.fields.length}`)
      this.log(`Who Am I: ${snapshot.manifest.capabilities.hasWhoAmIApi ? 'enabled' : 'disabled'}`)
      this.log(`Multi-auth: ${snapshot.manifest.capabilities.multiAuthEnabled ? 'enabled' : 'disabled'}`)
      if (locks.authTypeLocked && locks.lockedAuthType) {
        this.log(`Authentication type: locked to ${locks.lockedAuthType === 'oauth2' ? 'OAuth 2' : 'Basic'} by published version history`)
      }
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to load external authentication.')
    }
  }
}
