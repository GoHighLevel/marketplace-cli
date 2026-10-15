import type { ApiClient } from '../api/client.js'
import type { AppVersion } from '../api/types.js'
import { validateLocalBillingIntent } from '../billing/command-context.js'
import { applyBillingPush, planBillingPush } from '../billing/push.js'
import { loadBillingWorkspaceIfPresent } from '../billing/workspace.js'
import { CodedError, errorMessage } from '../shared/errors.js'
import { WORKFLOW_ACTIONS_RESOURCE } from '../workflows/actions/resource.js'
import { planWorkflowActionsSync } from '../workflows/actions/sync.js'
import { loadWorkflowActionsWorkspaceIfPresent } from '../workflows/actions/workspace.js'
import { applyWorkflowPush, planWorkflowPush } from '../workflows/shared/push.js'
import {
  type WorkflowResource,
  type WorkflowResourceManifest,
  workflowOperationLabel,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../workflows/shared/resource.js'
import { WORKFLOW_TRIGGERS_RESOURCE } from '../workflows/triggers/resource.js'
import { planWorkflowTriggersSync } from '../workflows/triggers/sync.js'
import { loadWorkflowTriggersWorkspaceIfPresent } from '../workflows/triggers/workspace.js'
import { persistSelection } from './context.js'
import { buildAppFiles } from './manifest.js'
import { type AppPushResult, executeAppSyncPlan } from './push.js'
import { validateDynamicAuthConfiguration } from './push-preflight.js'
import { loadAppVersionForExport } from './pull.js'
import { loadRemoteAppSyncContext, type RemoteAppSyncContext, validationError } from './sync-context.js'
import { validateSyncPlan, verifyAppliedChanges } from './sync.js'
import { type AppWorkspaceResult, writeAppWorkspace } from './workspace.js'
import {
  appChangeDetails,
  checkWorkspace,
  digestFiles,
  type ModuleCheck,
  type WorkspaceCheck,
  type WorkspaceModuleName
} from './workspace-check.js'

export interface AppPushOutcome extends AppPushResult {
  files: AppWorkspaceResult
}

/* The app push runs last: it refuses while workflow changes are unpushed,
   because the portal applies them through their own APIs. */
async function assertWorkflowModulesSynchronized(directory: string): Promise<void> {
  const [workflowActions, workflowTriggers, billing] = await Promise.all([
    loadWorkflowActionsWorkspaceIfPresent(directory),
    loadWorkflowTriggersWorkspaceIfPresent(directory),
    loadBillingWorkspaceIfPresent(directory)
  ])
  if (workflowActions) {
    const { baseline } = workflowActions.state
    if (planWorkflowActionsSync(baseline, workflowActions.manifest, baseline).localChanges.length > 0) {
      throw new Error(
        'Local workflow action changes are pending. Run `ghl app actions validate`, ' +
          '`ghl app actions diff`, and `ghl app actions push` before pushing app configuration.'
      )
    }
  }
  if (workflowTriggers) {
    const { baseline } = workflowTriggers.state
    if (planWorkflowTriggersSync(baseline, workflowTriggers.manifest, baseline).localChanges.length > 0) {
      throw new Error(
        'Local workflow trigger changes are pending. Run `ghl app triggers validate`, ' +
          '`ghl app triggers diff`, and `ghl app triggers push` before pushing app configuration.'
      )
    }
  }
  if (billing) {
    const billingErrors = await validateLocalBillingIntent(billing)
    if (billingErrors.length > 0) {
      throw new Error(`Billing configuration is invalid:\n- ${billingErrors.join('\n- ')}`)
    }
  }
}

/* Validates the app files against the portal and plans which API sections
   to update; nothing is sent until the plan is applied. */
export async function planAppPush(directory: string, client?: ApiClient): Promise<RemoteAppSyncContext> {
  await assertWorkflowModulesSynchronized(directory)
  const context = await loadRemoteAppSyncContext(directory, client)
  const validation = validateSyncPlan(context.plan, context.remoteVersion)
  if (validation.errors.length > 0) throw validationError(validation.errors)
  const dynamicErrors = await validateDynamicAuthConfiguration(context.client, context.plan)
  if (dynamicErrors.length > 0) throw validationError(dynamicErrors)
  return context
}

/* Pushes the planned sections, verifies them in the portal, and rewrites the
   workspace (which may now be bound to a new draft version). */
export async function applyAppPush(context: RemoteAppSyncContext): Promise<AppPushOutcome> {
  const pushed = await executeAppSyncPlan(context.client, context.remoteVersion, context.plan)
  try {
    const finalVersion: AppVersion =
      pushed.appliedSections.length > 0
        ? await loadAppVersionForExport(context.client, context.plan.appId, pushed.versionId)
        : context.remoteVersion
    const mismatches = verifyAppliedChanges(context.plan, buildAppFiles(finalVersion))
    if (mismatches.length > 0) {
      throw new Error(`these fields did not match after verification: ${mismatches.join(', ')}`)
    }
    const files = await writeAppWorkspace({ directory: context.local.directory, version: finalVersion })
    await persistSelection(context.client, context.config, {
      appId: context.plan.appId,
      versionId: finalVersion._id,
      name: finalVersion.name ?? context.local.files.app.basicInfo.name
    })
    return { ...pushed, versionId: finalVersion._id, files }
  } catch (error) {
    const reason = errorMessage(error, 'local synchronization failed')
    throw new Error(
      `The API push completed, but the CLI could not verify and synchronize local state: ${reason}. ` +
        'Run `ghl app pull` before making more changes.'
    )
  }
}

export interface ModulePushResult {
  name: WorkspaceModuleName
  /* Operations or app sections the portal accepted. */
  applied: string[]
  /* `operation: reason` for each rejected operation. */
  failed: string[]
  /* Why the module could not be pushed at all. */
  error?: string
  /* The app version the workspace is bound to after an app push. */
  versionId?: string
}

export type WorkspacePushOutcome =
  | { status: 'plan-changed'; check: WorkspaceCheck }
  | { status: 'pushed'; complete: boolean; results: ModulePushResult[] }

interface OperationResult {
  operation: string
  success: boolean
  error?: string
}

function executionResult(name: WorkspaceModuleName, results: readonly OperationResult[]): ModulePushResult {
  return {
    name,
    applied: results.filter(result => result.success).map(result => result.operation),
    failed: results.filter(result => !result.success).map(result => `${result.operation}: ${result.error ?? 'failed'}`)
  }
}

const pushesInProgress = new Set<string>()

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/* Each module is checked again just before it is sent: its files must still
   hash to the reviewed digest and its plan must run the reviewed operations,
   so nothing changed after review reaches the portal. */
async function pushModule(module: ModuleCheck, directory: string, client: ApiClient): Promise<ModulePushResult> {
  const { name } = module
  const changed = (): ModulePushResult => ({
    name,
    applied: [],
    failed: [],
    error: `The ${name} files or portal state changed after review; nothing more was pushed. Check the workspace again.`
  })
  try {
    /* Earlier modules rewrite the app files (billing updates the app's usage
       flag), so the app is pinned by its planned values instead. */
    if (name !== 'app' && (await digestFiles(module.sourceFiles)) !== module.sourceDigest) return changed()
    if (name === 'actions' || name === 'triggers') {
      const resource = name === 'actions' ? WORKFLOW_ACTIONS_RESOURCE : WORKFLOW_TRIGGERS_RESOURCE
      const pushed =
        resource === WORKFLOW_ACTIONS_RESOURCE
          ? await pushWorkflow(WORKFLOW_ACTIONS_RESOURCE, module, directory, client)
          : await pushWorkflow(WORKFLOW_TRIGGERS_RESOURCE, module, directory, client)
      return pushed ? executionResult(name, pushed) : changed()
    }
    if (name === 'billing') {
      const { context, operations } = await planBillingPush(directory, client)
      if (!sameList(operations, module.operations)) return changed()
      return executionResult(name, (await applyBillingPush(context)).execution.results)
    }
    const context = await planAppPush(directory, client)
    if (
      !sameList(context.plan.sections, module.operations) ||
      !sameList(appChangeDetails(context.plan), module.changeDetails)
    ) {
      return changed()
    }
    const pushed = await applyAppPush(context)
    return { name, applied: pushed.appliedSections, failed: [], versionId: pushed.versionId }
  } catch (error) {
    return { name, applied: [], failed: [], error: errorMessage(error, 'The push failed.') }
  }
}

async function pushWorkflow<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  module: ModuleCheck,
  directory: string,
  client: ApiClient
): Promise<OperationResult[] | undefined> {
  const context = await planWorkflowPush(resource, directory, client)
  if (!sameList(context.plan.operations.map(workflowOperationLabel), module.operations)) return undefined
  return (await applyWorkflowPush(resource, context)).execution.results
}

/* Pushes exactly the plan the user reviewed: the workspace is checked again,
   nothing is sent unless its plan id still matches and `approve` accepts it,
   and the push stops at the first module that did not fully apply. One push
   per workspace runs at a time. */
export async function pushWorkspace(
  binding: { directory: string; appId: string; versionId: string },
  client: ApiClient,
  planId: string,
  approve: (check: WorkspaceCheck) => Promise<void>
): Promise<WorkspacePushOutcome> {
  if (pushesInProgress.has(binding.directory)) {
    throw new CodedError('BUSY', 'A push of this workspace is already running.')
  }
  pushesInProgress.add(binding.directory)
  try {
    const check = await checkWorkspace(binding, client)
    if (check.planId !== planId) return { status: 'plan-changed', check }
    await approve(check)
    const results: ModulePushResult[] = []
    for (const module of check.modules.filter(candidate => candidate.localChanges.length > 0)) {
      const result = await pushModule(module, binding.directory, client)
      results.push(result)
      if (result.error || result.failed.length > 0) return { status: 'pushed', complete: false, results }
    }
    return { status: 'pushed', complete: true, results }
  } finally {
    pushesInProgress.delete(binding.directory)
  }
}
