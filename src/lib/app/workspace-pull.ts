import type { ApiClient } from '../api/client.js'
import type { AppVersion, VersionListItem } from '../api/types.js'
import { type BillingSnapshot, fetchBillingSnapshot } from '../billing/service.js'
import {
  assertBillingWorkspaceWritable,
  synchronizeUsageBillingSummary,
  writeBillingWorkspace
} from '../billing/workspace.js'
import type { CliConfig } from '../config/environment.js'
import { getSelectedApp, type SelectedApp } from '../config/selection-store.js'
import type { WorkflowActionsManifest } from '../workflows/actions/manifest.js'
import { validateWorkflowActionsManifest } from '../workflows/actions/schema.js'
import { fetchWorkflowActionsManifest } from '../workflows/actions/service.js'
import { planWorkflowActionsSync } from '../workflows/actions/sync.js'
import {
  assertWorkflowActionsWorkspaceWritable,
  loadWorkflowActionsPullBaseline,
  type WorkflowActionsWorkspace,
  writeWorkflowActionsWorkspace
} from '../workflows/actions/workspace.js'
import type { WorkflowTriggersManifest } from '../workflows/triggers/manifest.js'
import { validateWorkflowTriggersManifest } from '../workflows/triggers/schema.js'
import { fetchWorkflowTriggersManifest } from '../workflows/triggers/service.js'
import {
  assertWorkflowTriggersWorkspaceWritable,
  writeWorkflowTriggersWorkspace
} from '../workflows/triggers/workspace.js'
import { findAppItemById, toSelectedApp } from './context.js'
import {
  buildPullFilesOutput,
  loadAppVersionForExport,
  pullArtifactPlan,
  type PullWorkspaceBinding,
  resolveVersionId
} from './pull.js'
import { writeTypesWorkspace } from './types.js'
import { writeAppWorkspace } from './workspace.js'

export interface PullSnapshot {
  selected: SelectedApp
  version: AppVersion
  versions: VersionListItem[]
  workflowActions: WorkflowActionsManifest
  workflowTriggers: WorkflowTriggersManifest
  billing: BillingSnapshot
}

export interface PullSource {
  /* The workspace being refreshed; its app and version are the defaults. */
  workspace?: PullWorkspaceBinding
  appId?: string
  /* Version id or semantic version. */
  version?: string
}

export interface PullWriteOptions {
  /* True when `directory` is an existing workspace being refreshed. */
  refresh: boolean
  /* Replace local workflow-action changes and conflicts with the portal state. */
  force: boolean
  withTypes: boolean
}

/* Everything a workspace holds, read from the portal in one parallel round. */
export async function loadPullSnapshot(
  client: ApiClient,
  config: CliConfig,
  source: PullSource
): Promise<PullSnapshot> {
  const selected = source.workspace
    ? { appId: source.workspace.appId, versionId: source.workspace.versionId, name: source.workspace.name }
    : source.appId
      ? toSelectedApp(await findAppItemById(client, source.appId))
      : await getSelectedApp(config.configDir, client.activeProfileName)
  if (!selected) {
    throw new Error('No app selected. Pass an app id (`ghl app pull <appId>`) or run `ghl app use` first.')
  }
  const versions = await client.listVersions(selected.appId)
  const versionId = resolveVersionId(versions, source.version, selected.versionId)
  const [version, workflowActions, workflowTriggers, billing] = await Promise.all([
    loadAppVersionForExport(client, selected.appId, versionId),
    fetchWorkflowActionsManifest(client, selected.appId),
    fetchWorkflowTriggersManifest(client, selected.appId),
    fetchBillingSnapshot(client, selected.appId)
  ])
  return { selected, version, versions, workflowActions, workflowTriggers, billing }
}

/* Refuses a pull that would overwrite local or conflicting workflow-action
   work unless forced, and returns the local action sources to preserve. */
export async function preparePullDestination(
  directory: string,
  snapshot: PullSnapshot,
  options: Pick<PullWriteOptions, 'refresh' | 'force'>
): Promise<WorkflowActionsWorkspace | undefined> {
  const whiteLabel = snapshot.version.isWhiteLabelFriendly !== false
  const actionErrors = validateWorkflowActionsManifest(snapshot.workflowActions, { whiteLabel })
  if (actionErrors.length > 0) {
    throw new Error(`Workflow action configuration is invalid:\n- ${actionErrors.join('\n- ')}`)
  }
  const triggerErrors = validateWorkflowTriggersManifest(snapshot.workflowTriggers, { whiteLabel })
  if (triggerErrors.length > 0) {
    throw new Error(`Workflow trigger configuration is invalid:\n- ${triggerErrors.join('\n- ')}`)
  }
  const existingActions =
    options.refresh && !options.force ? await loadWorkflowActionsPullBaseline(directory) : undefined
  if (existingActions) {
    const actionPlan = planWorkflowActionsSync(
      existingActions.state.baseline,
      existingActions.manifest,
      snapshot.workflowActions,
      { codeSources: existingActions.codeSources }
    )
    const conflicts = [...new Set([...actionPlan.localChanges, ...actionPlan.conflicts])].sort()
    if (conflicts.length > 0) {
      throw new Error(
        `App pull would overwrite local or conflicting workflow-action changes:\n- ${conflicts.join('\n- ')}\n` +
          'Resolve them first, or pass --force to replace local sources with the portal state.'
      )
    }
  }
  if (options.refresh) {
    await Promise.all([
      assertWorkflowActionsWorkspaceWritable(directory, snapshot.workflowActions),
      assertWorkflowTriggersWorkspaceWritable(directory, snapshot.workflowTriggers),
      assertBillingWorkspaceWritable(directory, snapshot.billing.subscriptions, snapshot.billing.usage)
    ])
  }
  return existingActions
}

/* Writes every module of the snapshot; modules without items keep only
   their state files, so the result lists just what the app uses. */
export async function writePulledWorkspace(
  directory: string,
  snapshot: PullSnapshot,
  existingActions: WorkflowActionsWorkspace | undefined,
  options: PullWriteOptions
): Promise<Record<string, unknown>> {
  const { includeJsonSchema, includeTypeDeclarations } = pullArtifactPlan(options.withTypes)
  const { workflowActions, workflowTriggers, billing } = snapshot
  const appFiles = await writeAppWorkspace({ directory, version: snapshot.version, includeJsonSchema })
  const actionFiles = await writeWorkflowActionsWorkspace(directory, workflowActions, workflowActions, {
    includeJsonSchema,
    preserveCodeSources: options.force ? undefined : existingActions?.codeSources
  })
  const triggerFiles = await writeWorkflowTriggersWorkspace(directory, workflowTriggers, workflowTriggers, {
    includeJsonSchema
  })
  const billingFiles = await writeBillingWorkspace(
    directory,
    billing.subscriptions,
    billing.usage,
    { subscriptions: billing.subscriptions, usage: billing.usage },
    { includeJsonSchema }
  )
  await synchronizeUsageBillingSummary(directory, billing.usage.meters.length > 0, { includeJsonSchema })
  const files = buildPullFilesOutput({
    app: appFiles,
    ...(workflowActions.actions.length > 0 ? { actions: actionFiles } : {}),
    ...(workflowTriggers.triggers.length > 0 ? { triggers: triggerFiles } : {}),
    ...(billing.subscriptions.plans.length > 0 || billing.usage.meters.length > 0 ? { billing: billingFiles } : {})
  })
  return includeTypeDeclarations ? { ...files, ...(await writeTypesWorkspace(directory)) } : files
}

/* The selection a pull leaves behind: the pulled version of the app. */
export function pulledSelection(snapshot: PullSnapshot): SelectedApp {
  return {
    ...snapshot.selected,
    versionId: snapshot.version._id,
    name: snapshot.version.name ?? snapshot.selected.name ?? snapshot.selected.appId
  }
}
