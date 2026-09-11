import type { WorkflowTriggerSummary } from '../../api/types.js'
import { type WorkflowResource } from '../shared/resource.js'
import { workflowTriggerPrerequisiteErrors } from './contract.js'
import { createWorkflowTriggerScaffold, type WorkflowTriggersManifest } from './manifest.js'
import { validateWorkflowTriggersManifest } from './schema.js'
import {
  executeWorkflowTriggersSyncPlanIndependently,
  fetchWorkflowTriggersSnapshot,
  reconcileWorkflowTriggersAfterPush,
  verifyWorkflowTriggersApplied,
  workflowTriggerPublishCandidates
} from './service.js'
import { planWorkflowTriggersSync, type WorkflowTriggersSyncPlan } from './sync.js'
import {
  loadWorkflowTriggersWorkspace,
  workflowTriggerFilenameFromKey,
  type WorkflowTriggersWorkspace,
  type WorkflowTriggersWorkspaceResult,
  writeWorkflowTriggersWorkspace
} from './workspace.js'

export type WorkflowTriggersResource = WorkflowResource<
  WorkflowTriggersManifest,
  WorkflowTriggersSyncPlan,
  WorkflowTriggersWorkspace,
  WorkflowTriggersWorkspaceResult,
  WorkflowTriggerSummary
>

export const WORKFLOW_TRIGGERS_RESOURCE: WorkflowTriggersResource = {
  singular: 'trigger',
  plural: 'triggers',
  label: 'Workflow trigger',
  items: manifest => manifest.triggers,
  withScaffold: (manifest, name, key) => ({
    ...manifest,
    triggers: [...manifest.triggers, createWorkflowTriggerScaffold(name, key)].sort((left, right) =>
      left.key.localeCompare(right.key)
    )
  }),
  withoutItem: (manifest, key) => ({ ...manifest, triggers: manifest.triggers.filter(trigger => trigger.key !== key) }),
  filenameFromKey: workflowTriggerFilenameFromKey,
  loadWorkspace: loadWorkflowTriggersWorkspace,
  writeStagedSources: async (workspace, manifest) => {
    const files = await writeWorkflowTriggersWorkspace(workspace.directory, manifest, workspace.state.baseline)
    return { directory: files.triggerDirectory, files: files.triggerFiles }
  },
  writeWorkspace: writeWorkflowTriggersWorkspace,
  filesDirectory: files => files.triggerDirectory,
  stateFiles: files => ({ triggerStateFile: files.triggerStateFile }),
  validateManifest: (manifest, options = {}) =>
    validateWorkflowTriggersManifest(manifest, {
      publishable: options.publishable,
      triggerKey: options.key,
      version: options.version
    }),
  prerequisiteErrors: workspace =>
    workflowTriggerPrerequisiteErrors({
      triggerCount: workspace.manifest.triggers.length,
      allowedScopes: workspace.allowedScopes,
      redirectUris: workspace.redirectUris,
      clientKeyCount: workspace.clientKeyCount,
      userTypes: workspace.userTypes
    }),
  fetchSnapshot: fetchWorkflowTriggersSnapshot,
  planSync: planWorkflowTriggersSync,
  listSummaries: (client, appId) => client.listWorkflowTriggerSummaries(appId),
  summaryRow: summary => ({
    id: summary.triggerId,
    name: summary.name,
    version: summary.version,
    status: summary.status ?? 'draft'
  }),
  publishCandidates: (manifest, summaries, version) =>
    workflowTriggerPublishCandidates(manifest, summaries, version).map(candidate => ({
      item: candidate.trigger,
      version: candidate.version,
      repairRegistry: candidate.repairRegistry
    })),
  executePlan: (client, plan, runtime) => executeWorkflowTriggersSyncPlanIndependently(client, plan, { runtime }),
  verifyApplied: verifyWorkflowTriggersApplied,
  reconcileAfterPush: reconcileWorkflowTriggersAfterPush,
  createVersion: (client, appId, templateId) => client.createWorkflowTriggerVersion(appId, templateId),
  submitForReview: (client, appId, templateId, version, notes) =>
    client.submitWorkflowTriggerForReview(appId, {
      id: templateId,
      type: 'Trigger',
      version,
      releaseNotes: { user: notes, reviewer: notes }
    }),
  publishSummary: (client, appId, templateId, version) =>
    client.publishWorkflowTriggerSummary(appId, templateId, version)
}
