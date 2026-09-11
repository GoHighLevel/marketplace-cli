import { GhlCommand } from '../../lib/shared/command.js'
import { readPullWorkspaceBinding } from '../../lib/app/pull.js'
import { getConfig } from '../../lib/config/environment.js'
import { getSelectedApp } from '../../lib/config/selection-store.js'
import { loadActiveSession } from '../../lib/auth/session.js'

export default class AppCurrent extends GhlCommand {
  static description = 'Show the current workspace app or the stored app selection'

  static examples = ['<%= config.bin %> app current', '<%= config.bin %> app current --json']

  static enableJsonFlag = true

  protected async execute(): Promise<unknown> {
    const config = getConfig()
    const workspace = await readPullWorkspaceBinding(process.cwd())
    if (workspace) {
      const selected = {
        appId: workspace.appId,
        versionId: workspace.versionId,
        ...(workspace.name ? { name: workspace.name } : {})
      }
      if (this.jsonEnabled()) return { selected }
      this.log(
        `Current workspace app: "${selected.name ?? selected.appId}" ` +
          `(appId: ${selected.appId}, versionId: ${selected.versionId})`
      )
      return
    }
    const { name } = await loadActiveSession(config)
    const selected = await getSelectedApp(config.configDir, name)

    if (this.jsonEnabled()) return { selected: selected ?? null }

    if (!selected) {
      this.log('No app selected. Run `ghl app use` to select one.')
      return
    }
    this.log(`Selected app: "${selected.name}" (appId: ${selected.appId}, versionId: ${selected.versionId})`)
  }
}
