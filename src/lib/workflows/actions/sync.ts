import { WorkflowActionDefinition, WorkflowActionsManifest, WorkflowActionVersion } from './manifest.js'
import {
  CreateVersionedWorkflowOperation,
  DeleteVersionedWorkflowOperation,
  planVersionedWorkflowSync,
  UpdateVersionedWorkflowOperation,
  VersionedWorkflowSyncOperation,
  VersionedWorkflowSyncPlan
} from '../shared/versioned-sync.js'

export type CreateWorkflowActionOperation = CreateVersionedWorkflowOperation<WorkflowActionDefinition>
export type DeleteWorkflowActionOperation = DeleteVersionedWorkflowOperation
export type UpdateWorkflowActionOperation = UpdateVersionedWorkflowOperation<WorkflowActionVersion>
export type WorkflowActionSyncOperation = VersionedWorkflowSyncOperation<WorkflowActionDefinition, WorkflowActionVersion>
export type WorkflowActionsSyncPlan = VersionedWorkflowSyncPlan<WorkflowActionDefinition, WorkflowActionVersion>

function adaptable(manifest: WorkflowActionsManifest) {
  return { schemaVersion: manifest.schemaVersion, appId: manifest.appId, items: manifest.actions }
}

export function planWorkflowActionsSync(
  baseline: WorkflowActionsManifest,
  local: WorkflowActionsManifest,
  remote: WorkflowActionsManifest
): WorkflowActionsSyncPlan {
  return planVersionedWorkflowSync(adaptable(baseline), adaptable(local), adaptable(remote), {
    collection: 'actions',
    singular: 'action',
    command: 'actions'
  })
}
