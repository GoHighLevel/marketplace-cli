import {
  CreateVersionedWorkflowOperation,
  DeleteVersionedWorkflowOperation,
  planVersionedWorkflowSync,
  UpdateVersionedWorkflowOperation,
  VersionedWorkflowSyncOperation,
  VersionedWorkflowSyncPlan
} from '../shared/versioned-sync.js'
import {
  WorkflowTriggerDefinition,
  WorkflowTriggersManifest,
  WorkflowTriggerVersion
} from './manifest.js'

export type CreateWorkflowTriggerOperation = CreateVersionedWorkflowOperation<WorkflowTriggerDefinition>
export type DeleteWorkflowTriggerOperation = DeleteVersionedWorkflowOperation
export type UpdateWorkflowTriggerOperation = UpdateVersionedWorkflowOperation<WorkflowTriggerVersion>
export type WorkflowTriggerSyncOperation = VersionedWorkflowSyncOperation<WorkflowTriggerDefinition, WorkflowTriggerVersion>
export type WorkflowTriggersSyncPlan = VersionedWorkflowSyncPlan<WorkflowTriggerDefinition, WorkflowTriggerVersion>

function adaptable(manifest: WorkflowTriggersManifest) {
  return { schemaVersion: manifest.schemaVersion, appId: manifest.appId, items: manifest.triggers }
}

export function planWorkflowTriggersSync(
  baseline: WorkflowTriggersManifest,
  local: WorkflowTriggersManifest,
  remote: WorkflowTriggersManifest
): WorkflowTriggersSyncPlan {
  return planVersionedWorkflowSync(adaptable(baseline), adaptable(local), adaptable(remote), {
    collection: 'triggers',
    singular: 'trigger',
    command: 'triggers'
  })
}
