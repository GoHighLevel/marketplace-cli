import type { ApiClient } from '../api/client.js'
import type {
  AppVersion,
  PreSubmitValidation,
  VersionAnalysis,
  VersionListItem,
  WorkflowActionSummary,
  WorkflowTriggerSummary
} from '../api/types.js'
import type { CliConfig } from '../config/environment.js'
import { getSelectedApp, type SelectedApp } from '../config/selection-store.js'
import { CodedError, errorMessage } from '../shared/errors.js'
import { resolveAppDetails } from './context.js'
import { readPullWorkspaceBinding } from './pull.js'
import type { AppContext } from './section-context.js'
import { normalizeStatus } from './rules.js'

/* A read that may fail without failing the overview it belongs to. */
export type Optional<T> = { value: T } | { error: string }

export interface AppOverview {
  selected: SelectedApp
  version: AppVersion
  versions: VersionListItem[]
  actions: Optional<WorkflowActionSummary[]>
  triggers: Optional<WorkflowTriggerSummary[]>
  /* Only for editable (draft or disapproved) versions. */
  readiness?: Optional<PreSubmitValidation>
  analysis?: Optional<VersionAnalysis>
}

export interface AppTarget {
  appId?: string
  /* A folder inside an app workspace; its bound app version is used. */
  directory?: string
}

const EDITABLE_STATUSES = new Set(['draft', 'disapproved'])

async function optional<T>(read: Promise<T>): Promise<Optional<T>> {
  try {
    return { value: await read }
  } catch (error) {
    return { error: errorMessage(error, 'unavailable') }
  }
}

/* An explicit app id wins, then the workspace at `directory`, then the
   app selected with `ghl app use`. */
export async function resolveTargetApp(client: ApiClient, config: CliConfig, target: AppTarget): Promise<SelectedApp> {
  if (target.appId) return (await resolveAppDetails(client, config, target.appId)).selected
  const binding = target.directory ? await readPullWorkspaceBinding(target.directory) : undefined
  if (binding) {
    return { appId: binding.appId, versionId: binding.versionId, ...(binding.name ? { name: binding.name } : {}) }
  }
  const selected = await getSelectedApp(config.configDir, client.activeProfileName)
  if (selected) return selected
  throw new CodedError(
    'NO_APP',
    target.directory
      ? `"${target.directory}" is not inside an app workspace and no app is selected. Pass an appId.`
      : 'No app is selected. Pass an appId or the directory of an app workspace.'
  )
}

export function isEditableStatus(status: string | undefined): boolean {
  return EDITABLE_STATUSES.has(normalizeStatus(status))
}

/* Everything about one app version in a single round of parallel reads.
   Secondary reads degrade to an error note instead of failing the overview. */
export async function loadAppOverview(client: ApiClient, config: CliConfig, target: AppTarget): Promise<AppOverview> {
  const selected = await resolveTargetApp(client, config, target)
  const { appId, versionId } = selected
  const [version, versions, actions, triggers] = await Promise.all([
    client.getVersion(appId, versionId),
    client.listVersions(appId),
    optional(client.listWorkflowActionSummaries(appId)),
    optional(client.listWorkflowTriggerSummaries(appId))
  ])
  if (!isEditableStatus(version.status)) return { selected, version, versions, actions, triggers }
  const [readiness, analysis] = await Promise.all([
    optional(client.preSubmitValidation(appId, versionId)),
    optional(client.analyzeVersion(appId, versionId))
  ])
  return { selected, version, versions, actions, triggers, readiness, analysis }
}

/* The app (as resolved for `target`) and its current version, ready for a
   command that changes it. */
export async function loadTargetContext(client: ApiClient, config: CliConfig, target: AppTarget): Promise<AppContext> {
  const selected = await resolveTargetApp(client, config, target)
  return { client, config, selected, version: await client.getVersion(selected.appId, selected.versionId) }
}
