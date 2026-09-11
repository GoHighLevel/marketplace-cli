import type { WorkflowActionSummary } from '../../api/client.js'
import { type WorkflowResource } from '../shared/resource.js'
import { workflowActionPrerequisiteErrors } from './contract.js'
import { createWorkflowActionScaffold, type WorkflowActionsManifest } from './manifest.js'
import { validateWorkflowActionsManifest } from './schema.js'
import {
  executeWorkflowActionsSyncPlanIndependently,
  fetchWorkflowActionsSnapshot,
  reconcileWorkflowActionsAfterPush,
  verifyWorkflowActionsApplied,
  workflowActionPublishCandidates
} from './service.js'
import { planWorkflowActionsSync, type WorkflowActionsSyncPlan } from './sync.js'
import {
  loadWorkflowActionsWorkspace,
  workflowActionFilenameFromKey,
  type WorkflowActionsWorkspace,
  type WorkflowActionsWorkspaceResult,
  writeLocalWorkflowActionsManifest,
  writeWorkflowActionsWorkspace
} from './workspace.js'

export type WorkflowActionsResource = WorkflowResource<
  WorkflowActionsManifest,
  WorkflowActionsSyncPlan,
  WorkflowActionsWorkspace,
  WorkflowActionsWorkspaceResult,
  WorkflowActionSummary
>

export const WORKFLOW_ACTIONS_RESOURCE: WorkflowActionsResource = {
  singular: 'action',
  plural: 'actions',
  label: 'Workflow action',
  items: manifest => manifest.actions,
  withScaffold: (manifest, name, key) => ({
    ...manifest,
    actions: [...manifest.actions, createWorkflowActionScaffold(name, key)].sort((left, right) =>
      left.key.localeCompare(right.key)
    )
  }),
  withoutItem: (manifest, key) => ({ ...manifest, actions: manifest.actions.filter(action => action.key !== key) }),
  filenameFromKey: workflowActionFilenameFromKey,
  loadWorkspace: loadWorkflowActionsWorkspace,
  writeStagedSources: async (workspace, manifest) => {
    const files = await writeLocalWorkflowActionsManifest(workspace.directory, manifest)
    return { directory: files.actionDirectory, files: files.actionFiles }
  },
  writeWorkspace: writeWorkflowActionsWorkspace,
  filesDirectory: files => files.actionDirectory,
  stateFiles: files => ({ stateFile: files.stateFile }),
  validateManifest: (manifest, options = {}) =>
    validateWorkflowActionsManifest(manifest, {
      publishable: options.publishable,
      actionKey: options.key,
      version: options.version
    }),
  prerequisiteErrors: workspace =>
    workflowActionPrerequisiteErrors(workspace.allowedScopes, workspace.manifest.actions.length),
  fetchSnapshot: fetchWorkflowActionsSnapshot,
  planSync: planWorkflowActionsSync,
  listSummaries: (client, appId) => client.listWorkflowActionSummaries(appId),
  summaryRow: summary => ({
    id: summary.actionId,
    name: summary.name,
    version: summary.version,
    status: summary.status
  }),
  publishCandidates: (manifest, summaries, version) =>
    workflowActionPublishCandidates(manifest, summaries, version).map(candidate => ({
      item: candidate.action,
      version: candidate.version,
      repairRegistry: candidate.repairRegistry
    })),
  executePlan: (client, plan, runtime) => executeWorkflowActionsSyncPlanIndependently(client, plan, { runtime }),
  verifyApplied: verifyWorkflowActionsApplied,
  reconcileAfterPush: reconcileWorkflowActionsAfterPush,
  createVersion: (client, appId, templateId) => client.createWorkflowActionVersion(appId, templateId),
  submitForReview: (client, appId, templateId, version, notes) =>
    client.submitWorkflowActionForReview(appId, {
      id: templateId,
      type: 'Action',
      version,
      releaseNotes: { user: notes, reviewer: notes }
    }),
  publishSummary: (client, appId, templateId, version) =>
    client.publishWorkflowActionSummary(appId, templateId, version)
}
