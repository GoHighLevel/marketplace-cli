import { ApiClient, AppListItem } from '../api/client.js'
import { readPullWorkspaceBinding } from './pull.js'
import { CliConfig } from '../config/environment.js'
import { getSelectedApp, saveSelectedApp, SelectedApp } from '../config/selection-store.js'

export function toSelectedApp(item: AppListItem): SelectedApp {
  return { appId: String(item.appId ?? item._id), versionId: String(item._id), name: item.name }
}

export async function toLatestSelectedApp(client: ApiClient, item: AppListItem): Promise<SelectedApp> {
  const appId = String(item.appId ?? item._id)
  const latest = await client.getLatestVersion(appId)
  return {
    appId: String(latest.appId ?? appId),
    versionId: latest._id,
    ...(latest.name ?? item.name ? { name: latest.name ?? item.name } : {})
  }
}

export async function listAllApps(client: ApiClient): Promise<AppListItem[]> {
  const limit = 100
  const all: AppListItem[] = []
  for (let skip = 0; ; skip += limit) {
    const { apps, totalCount } = await client.listApps({ skip, limit })
    all.push(...apps)
    if (apps.length === 0 || all.length >= totalCount) return all
  }
}

function matchesAppId(app: AppListItem, appId: string): boolean {
  return String(app.appId ?? app._id) === appId || String(app._id) === appId
}

export async function findAppItemById(client: ApiClient, appId: string, nameHint?: string): Promise<AppListItem> {
  if (nameHint?.trim()) {
    const result = await client.listApps({ skip: 0, limit: 100, search: nameHint.trim() })
    const match = result.apps.find(app => matchesAppId(app, appId))
    if (match) return match
  }
  const apps = await listAllApps(client)
  const match = apps.find(app => matchesAppId(app, appId))
  if (match) return match
  throw new Error(`App "${appId}" not found in your developer account. Run \`ghl app list\` to see available apps.`)
}

export async function findAppById(client: ApiClient, appId: string): Promise<SelectedApp> {
  const item = await findAppItemById(client, appId)
  return appId === String(item.appId ?? item._id)
    ? toLatestSelectedApp(client, item)
    : toSelectedApp(item)
}

export interface ResolvedAppDetails {
  selected: SelectedApp
  summary?: AppListItem
}

export async function resolveAppDetails(
  client: ApiClient,
  config: CliConfig,
  flagAppId?: string,
  workspaceDirectory = process.cwd()
): Promise<ResolvedAppDetails> {
  if (flagAppId) {
    const summary = await findAppItemById(client, flagAppId)
    const appId = String(summary.appId ?? summary._id)
    const selected = flagAppId === appId
      ? await toLatestSelectedApp(client, summary)
      : toSelectedApp(summary)
    return { selected, summary }
  }
  const workspace = await readPullWorkspaceBinding(workspaceDirectory)
  if (workspace) {
    return {
      selected: {
        appId: workspace.appId,
        versionId: workspace.versionId,
        ...(workspace.name ? { name: workspace.name } : {})
      }
    }
  }
  const selected = await getSelectedApp(config.configDir, client.activeProfileName)
  if (selected) return { selected }
  throw new Error('No app selected. Run `ghl app use` to select one, or pass --app <appId>.')
}

/* Resolution order is explicit flag, enclosing workspace, then stored selection.
   Interactive pickers live in commands, not in shared app resolution. */
export async function resolveApp(
  client: ApiClient,
  config: CliConfig,
  flagAppId?: string,
  workspaceDirectory = process.cwd()
): Promise<SelectedApp> {
  return (await resolveAppDetails(client, config, flagAppId, workspaceDirectory)).selected
}

export async function persistSelection(client: ApiClient, config: CliConfig, app: SelectedApp): Promise<void> {
  await saveSelectedApp(config.configDir, client.activeProfileName, app)
}
