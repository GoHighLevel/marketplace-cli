import { ApiClient, type AppVersion, type ProfileUpdateResult } from '../api/client.js'
import { persistSelection, resolveApp } from './context.js'
import { type CliConfig, getConfig } from '../config/environment.js'
import { type SelectedApp } from '../config/selection-store.js'
import { extractNewVersion } from './profile-sections.js'
import { withSpinner } from '../shared/spinner.js'

export interface AppContext {
  client: ApiClient
  config: CliConfig
  selected: SelectedApp
  version: AppVersion
}

export async function loadAppContext(flagAppId?: string, quiet = false): Promise<AppContext> {
  const config = getConfig()
  const client = new ApiClient(config)
  const { selected, version } = await withSpinner(
    'Loading app...',
    async () => {
      await client.init()
      const selected = await resolveApp(client, config, flagAppId)
      const version = await client.getVersion(selected.appId, selected.versionId)
      return { selected, version }
    },
    { quiet }
  )
  return { client, config, selected, version }
}

/* Edits to a live version produce a new pending draft with a new versionId;
   follow it in the stored selection so later commands hit the right draft. */
export async function followVersionChange(
  context: AppContext,
  result: ProfileUpdateResult,
  log: (message: string) => void
): Promise<void> {
  const next = extractNewVersion(result)
  if (!next.versionId || next.versionId === context.selected.versionId) return
  const updated = {
    ...context.selected,
    appId: next.appId ?? context.selected.appId,
    versionId: next.versionId
  }
  await persistSelection(context.client, context.config, updated)
  context.selected = updated
  log(`Changes were saved to a new draft version (${next.versionId}) — selection updated to follow it.`)
}
