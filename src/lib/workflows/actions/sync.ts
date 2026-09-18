import { type WorkflowActionDefinition, type WorkflowActionsManifest, type WorkflowActionVersion } from './manifest.js'
import {
  type CreateVersionedWorkflowOperation,
  type DeleteVersionedWorkflowOperation,
  planVersionedWorkflowSync,
  type UpdateVersionedWorkflowOperation,
  type VersionedWorkflowSyncOperation,
  type VersionedWorkflowSyncPlan
} from '../shared/versioned-sync.js'
import type { WorkflowActionCodeSource } from './workspace.js'

export type CreateWorkflowActionOperation = CreateVersionedWorkflowOperation<WorkflowActionDefinition>
export type DeleteWorkflowActionOperation = DeleteVersionedWorkflowOperation
export type UpdateWorkflowActionOperation = UpdateVersionedWorkflowOperation<WorkflowActionVersion>
export type WorkflowActionSyncOperation = VersionedWorkflowSyncOperation<
  WorkflowActionDefinition,
  WorkflowActionVersion
>
export type WorkflowActionsSyncPlan = VersionedWorkflowSyncPlan<WorkflowActionDefinition, WorkflowActionVersion>

export interface WorkflowActionsSyncOptions {
  codeSources?: readonly WorkflowActionCodeSource[]
}

function adaptable(manifest: WorkflowActionsManifest) {
  return { schemaVersion: manifest.schemaVersion, appId: manifest.appId, items: manifest.actions }
}

export function planWorkflowActionsSync(
  baseline: WorkflowActionsManifest,
  local: WorkflowActionsManifest,
  remote: WorkflowActionsManifest,
  options: WorkflowActionsSyncOptions = {}
): WorkflowActionsSyncPlan {
  const plan = planVersionedWorkflowSync<WorkflowActionVersion, WorkflowActionDefinition>(
    adaptable(baseline),
    adaptable(local),
    adaptable(remote),
    {
      collection: 'actions',
      singular: 'action',
      command: 'actions'
    }
  )
  for (const source of options.codeSources ?? []) {
    if (source.language !== 'typescript') continue
    const baselineAction = baseline.actions.find(action => action.key === source.actionKey)
    const remoteAction = remote.actions.find(action => action.key === source.actionKey)
    const baselineCode = baselineAction?.versions.find(version => version.version === source.version)?.executionConfig
      ?.code
    const remoteCode = remoteAction?.versions.find(version => version.version === source.version)?.executionConfig?.code
    if (remoteCode !== baselineCode && remoteCode !== source.compiledCode) {
      plan.conflicts.push(`actions.${source.actionKey}.versions.${source.version}.executionConfig.code`)
    }
  }
  plan.conflicts = [...new Set(plan.conflicts)].sort()
  if (plan.conflicts.length > 0) plan.operations = []
  return plan
}
