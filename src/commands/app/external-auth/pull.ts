import { Command, Flags } from '@oclif/core'

import { loadExternalAuthRemoteContext } from '../../../lib/external-auth/command-context.js'
import { fetchExternalAuthSnapshot, resolveExternalAuthLocks } from '../../../lib/external-auth/service.js'
import { writeExternalAuthWorkspace } from '../../../lib/external-auth/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppExternalAuthPull extends Command {
  static description = 'Pull external-auth settings into a secret-safe local JSON workspace'

  static examples = [
    '<%= config.bin %> app external-auth pull',
    '<%= config.bin %> app external-auth pull --directory ./my-app --json'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id; must match the workspace app' }),
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppExternalAuthPull)
    try {
      const context = await loadExternalAuthRemoteContext({
        appId: flags.app,
        directory: flags.directory,
        requireWorkspaceMatch: true
      })
      if (!context.directory) {
        throw new Error('No ghl-app.json was found. Run this command inside an app workspace or pass --directory.')
      }
      const snapshot = await withSpinner(
        'Pulling external authentication...',
        () => fetchExternalAuthSnapshot(context.client, context.appId, context.versionId),
        { quiet: this.jsonEnabled() }
      )
      const locks = await resolveExternalAuthLocks(context.client, context.appId, {
        versionId: context.versionId,
        response: snapshot.raw
      })
      const files = await writeExternalAuthWorkspace(
        context.directory,
        snapshot.manifest,
        snapshot.manifest,
        locks
      )
      const result = {
        appId: context.appId,
        versionId: context.versionId,
        enabled: snapshot.manifest.enabled,
        type: snapshot.manifest.type,
        files
      }
      if (this.jsonEnabled()) return result
      this.log(`Pulled ${snapshot.manifest.type === 'oauth2' ? 'OAuth 2' : 'Basic'} external authentication.`)
      this.log(`  Config: ${files.configFile}`)
      this.log(`  Guide:  ${files.guideFile}`)
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to pull external authentication.')
    }
  }
}
