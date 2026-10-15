import type { ApiClient } from '../api/client.js'
import type { AppVersion, CreatedApp } from '../api/types.js'
import { emptyBillingSubscriptionManifest, emptyBillingUsageManifest } from '../billing/manifest.js'
import { writeBillingWorkspace } from '../billing/workspace.js'
import type { CliConfig } from '../config/environment.js'
import type { SelectedApp } from '../config/selection-store.js'
import { errorMessage } from '../shared/errors.js'
import { createEmptyWorkflowActionsManifest } from '../workflows/actions/manifest.js'
import { writeWorkflowActionsWorkspace } from '../workflows/actions/workspace.js'
import { createEmptyWorkflowTriggersManifest } from '../workflows/triggers/manifest.js'
import { writeWorkflowTriggersWorkspace } from '../workflows/triggers/workspace.js'
import { persistSelection, toSelectedApp } from './context.js'
import { loadAppVersionForExport } from './pull.js'
import { type AppWorkspaceResult, writeAppWorkspace } from './workspace.js'

/* A new app's workspace: the app files plus empty workflow and billing
   modules, so every later command finds its baseline. */
export async function initializeAppWorkspace(directory: string, version: AppVersion): Promise<AppWorkspaceResult> {
  const appId = version.appId ?? version._id
  const appFiles = await writeAppWorkspace({ directory, version })
  await writeWorkflowActionsWorkspace(directory, createEmptyWorkflowActionsManifest(appId))
  await writeWorkflowTriggersWorkspace(directory, createEmptyWorkflowTriggersManifest(appId))
  await writeBillingWorkspace(directory, emptyBillingSubscriptionManifest(appId), emptyBillingUsageManifest(appId))
  return appFiles
}

export interface CreatedAppWorkspace {
  selected: SelectedApp
  files: AppWorkspaceResult
}

/* After the portal created the app: select it and write its workspace. The
   app already exists if this fails, so the error says how to recover it. */
export async function initializeCreatedApp(
  client: ApiClient,
  config: CliConfig,
  created: CreatedApp,
  directory: string
): Promise<CreatedAppWorkspace> {
  const selected = toSelectedApp(created)
  try {
    await persistSelection(client, config, selected)
    const version = await loadAppVersionForExport(client, selected.appId, selected.versionId)
    const files = await initializeAppWorkspace(directory, { ...version, name: version.name ?? selected.name })
    return { selected, files }
  } catch (error) {
    const reason = errorMessage(error, 'Local initialization failed.')
    throw new Error(
      `The app was created (appId: ${selected.appId}, versionId: ${selected.versionId}), ` +
        `but its local files could not be initialized: ${reason} ` +
        `Run \`ghl app pull ${selected.appId}\` to recover it.`
    )
  }
}
