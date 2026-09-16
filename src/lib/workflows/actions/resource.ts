import type { WorkflowActionSummary } from '../../api/types.js'
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
  loadWorkflowActionsWorkspaceIfPresent,
  type WorkflowActionCodeSourceOverride,
  workflowActionFilenameFromKey,
  type WorkflowActionsWorkspace,
  type WorkflowActionsWorkspaceResult,
  writeLocalWorkflowActionsManifest,
  writeWorkflowActionsWorkspace
} from './workspace.js'
import path from 'node:path'
import {
  compileWorkflowActionJavaScript,
  compileWorkflowActionTypeScript,
  generateWorkflowActionJavaScriptScaffold,
  generateWorkflowActionTypeScriptScaffold
} from './typescript.js'
import { workflowActionCodeFilename } from './code.js'

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
  preserveSourceWorkspace: true,
  items: manifest => manifest.actions,
  withScaffold: (manifest, name, key) => {
    const action = createWorkflowActionScaffold(name, key)
    action.versions[0].executionConfig = { type: 'CODE', code: '' }
    return {
      ...manifest,
      actions: [...manifest.actions, action].sort((left, right) => left.key.localeCompare(right.key))
    }
  },
  withoutItem: (manifest, key) => ({ ...manifest, actions: manifest.actions.filter(action => action.key !== key) }),
  filenameFromKey: workflowActionFilenameFromKey,
  loadWorkspace: loadWorkflowActionsWorkspace,
  loadWorkspaceIfPresent: loadWorkflowActionsWorkspaceIfPresent,
  writeStagedSources: async (workspace, manifest, options) => {
    let stagedManifest = manifest
    const codeSourceOverrides: WorkflowActionCodeSourceOverride[] = []
    const existingKeys = new Set(workspace.manifest.actions.map(action => action.key))
    const action = manifest.actions.find(candidate => !existingKeys.has(candidate.key))
    const version = action?.versions[0]
    if (!action || !version) throw new Error('The new workflow action could not be identified for code setup.')
    const language = options?.typescript ? 'typescript' : 'javascript'
    const source = options?.typescript
      ? generateWorkflowActionTypeScriptScaffold(action, version)
      : generateWorkflowActionJavaScriptScaffold(action, version)
    const filename = path.join(
      workspace.codeDirectory,
      workflowActionCodeFilename(action.key, version.version, language)
    )
    const compiled = options?.typescript
      ? compileWorkflowActionTypeScript({ directory: workspace.directory, filename, source, action, version })
      : compileWorkflowActionJavaScript({ directory: workspace.directory, filename, source, action, version })
    if (compiled.errors.length > 0) {
      throw new Error(
        `Generated ${options?.typescript ? 'TypeScript' : 'JavaScript'} action is invalid:\n- ${compiled.errors.join('\n- ')}`
      )
    }
    stagedManifest = structuredClone(manifest)
    const stagedAction = stagedManifest.actions.find(candidate => candidate.key === action.key)
    const stagedVersion = stagedAction?.versions.find(candidate => candidate.version === version.version)
    if (!stagedVersion) throw new Error('The new workflow action version could not be staged.')
    stagedVersion.executionConfig = { type: 'CODE', code: compiled.code }
    codeSourceOverrides.push({
      actionKey: action.key,
      version: version.version,
      language,
      source,
      compiledCode: compiled.code
    })
    const files = await writeLocalWorkflowActionsManifest(workspace.directory, stagedManifest, {
      preserveCodeSources: workspace.codeSources,
      codeSourceOverrides
    })
    return { directory: files.actionDirectory, files: files.actionFiles }
  },
  writeWorkspace: (directory, manifest, baseline = manifest, sourceWorkspace) =>
    writeWorkflowActionsWorkspace(directory, manifest, baseline, {
      preserveCodeSources: sourceWorkspace?.codeSources
    }),
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
  planSync: (baseline, local, remote, workspace) =>
    planWorkflowActionsSync(baseline, local, remote, { codeSources: workspace?.codeSources }),
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
