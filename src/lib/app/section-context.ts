import { ApiClient } from '../api/client.js'
import type { AppVersion, ProfileUpdateResult } from '../api/types.js'
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

/* followVersionChange for a command that logs the notes or reports them in its JSON result. */
export async function followVersionChangeNotes(context: AppContext, result: ProfileUpdateResult): Promise<string[]> {
  const notes: string[] = []
  await followVersionChange(context, result, note => notes.push(note))
  return notes
}

/* The JSON result of a command that changed an app version: the version it
   ended on (a new draft when the edit moved there), what changed, and notes. */
export function versionResult(context: AppContext, fields: object, notes: string[] = []): Record<string, unknown> {
  return {
    appId: context.selected.appId,
    versionId: context.selected.versionId,
    ...fields,
    ...(notes.length > 0 ? { notes } : {})
  }
}
