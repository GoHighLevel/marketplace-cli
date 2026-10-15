import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

import type { ApiClient } from '../api/client.js'
import { loadBillingSyncContext, validateLocalBillingIntent } from '../billing/command-context.js'
import { billingSubscriptionOperationLabel, billingUsageOperationLabel } from '../billing/service.js'
import { planBillingSubscriptionSync, planBillingUsageSync } from '../billing/sync.js'
import { type BillingWorkspace, loadBillingWorkspaceIfPresent } from '../billing/workspace.js'
import { errorMessage } from '../shared/errors.js'
import { WORKFLOW_ACTIONS_RESOURCE } from '../workflows/actions/resource.js'
import { describeSecretUse, workflowSecretsToNewTargets } from '../workflows/shared/nested-headers.js'
import { loadWorkflowActionsWorkspaceIfPresent, type WorkflowActionsWorkspace } from '../workflows/actions/workspace.js'
import { loadWorkflowSyncContext } from '../workflows/shared/context.js'
import {
  type WorkflowResource,
  type WorkflowResourceManifest,
  workflowOperationLabel,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../workflows/shared/resource.js'
import { WORKFLOW_TRIGGERS_RESOURCE } from '../workflows/triggers/resource.js'
import {
  loadWorkflowTriggersWorkspaceIfPresent,
  type WorkflowTriggersWorkspace
} from '../workflows/triggers/workspace.js'
import { validateDynamicAuthConfiguration } from './push-preflight.js'
import { type LocalAppWorkspace, readLocalAppWorkspace } from './local-workspace.js'
import {
  createAppSyncPlan,
  type AppSyncChange,
  type AppSyncPlan,
  validateLocalAppWorkspace,
  validateSyncPlan
} from './sync.js'
import { loadRemoteAppSyncContext } from './sync-context.js'

export type WorkspaceModuleName = 'actions' | 'triggers' | 'billing' | 'app'

export interface ModuleCheck {
  name: WorkspaceModuleName
  /* Workflow actions or triggers, or billing plans and meters. */
  items?: number
  errors: string[]
  localChanges: string[]
  portalChanges: string[]
  conflicts: string[]
  /* The API operations a push would run, known once compared with the portal. */
  operations: string[]
  /* Header secrets the push would send to a destination the portal does not
     use today; pushing them needs the user's direct approval. */
  secretTargets: string[]
  /* `path: before -> after` for app fields, shown when the user approves. */
  changeDetails: string[]
  /* Digest of the module's source and state files, so a plan can tell when
     the files changed after it was reviewed. */
  sourceDigest: string
  sourceFiles: string[]
  /* Why the portal comparison could not run; local results still stand. */
  remoteError?: string
  /* The module's files could not be read, so its local changes are unknown. */
  unreadable?: true
}

export interface WorkspaceCheck {
  directory: string
  appId: string
  versionId: string
  /* True when local files were compared with the portal. */
  compared: boolean
  /* Why a requested portal comparison could not run at all. */
  remoteError?: string
  /* In push order: workflow modules before the app, which refuses to push
     while workflow changes are pending. */
  modules: ModuleCheck[]
  /* Identifies a reviewed, pushable plan: present only when compared with
     the portal, valid, conflict-free, and changed. */
  planId?: string
}

interface ModuleState {
  errors: string[]
  localChanges: string[]
  sourceDigest?: string
  sourceFiles?: string[]
}

type ComparedState = Pick<ModuleCheck, 'errors' | 'localChanges' | 'portalChanges' | 'conflicts' | 'operations'> &
  Partial<Pick<ModuleCheck, 'secretTargets' | 'changeDetails'>>

const PREVIEW_LENGTH = 120
const UNREADABLE = 'The workspace files could not be read consistently; check again.'

const PLAN_ID_LENGTH = 12

/* Fails closed: a file that cannot be read yields no digest, which blocks a plan. */
export async function digestFiles(files: ReadonlyArray<string | undefined>): Promise<string | undefined> {
  const hash = createHash('sha256')
  try {
    for (const file of [...new Set(files.filter((value): value is string => Boolean(value)))].sort()) {
      hash.update(`${file}\0`)
      hash.update(await fs.readFile(file))
      hash.update('\0')
    }
  } catch {
    return undefined
  }
  return hash.digest('hex')
}

async function withDigest(state: ModuleState, files: ReadonlyArray<string | undefined>): Promise<ModuleState> {
  const sourceFiles = files.filter((file): file is string => Boolean(file))
  const digest = await digestFiles(sourceFiles)
  return digest === undefined
    ? { ...state, errors: [...state.errors, UNREADABLE] }
    : { ...state, sourceDigest: digest, sourceFiles }
}

/* `path: before -> after` for each local app change, as the user reviews it. */
export function appChangeDetails(plan: Pick<AppSyncPlan, 'localChanges'>): string[] {
  return plan.localChanges.map(change => `${change.path}: ${preview(change.baseline)} -> ${preview(change.local)}`)
}

function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? 'unset'
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text
}

/* Loaders report invalid files as one error whose message lists each
   problem on a `- ` line; each problem becomes its own entry. */
export function errorItems(error: unknown): string[] {
  const [summary, ...items] = errorMessage(error, 'The files could not be read.').split('\n- ')
  return items.length > 0 ? items : [summary]
}

function emptyCheck(name: WorkspaceModuleName, state: ModuleState, items?: number): ModuleCheck {
  return {
    name,
    ...(items === undefined ? {} : { items }),
    sourceDigest: '',
    sourceFiles: [],
    ...state,
    portalChanges: [],
    conflicts: [],
    operations: [],
    secretTargets: [],
    changeDetails: []
  }
}

function unreadableCheck(name: WorkspaceModuleName, error: unknown): ModuleCheck {
  return { ...emptyCheck(name, { errors: errorItems(error), localChanges: [] }), unreadable: true }
}

async function compared(
  local: ModuleCheck,
  client: ApiClient | undefined,
  compare: (client: ApiClient) => Promise<ComparedState>
): Promise<ModuleCheck> {
  if (!client || local.errors.length > 0) return local
  try {
    return { ...local, ...(await compare(client)) }
  } catch (error) {
    return { ...local, remoteError: errorMessage(error, 'The portal comparison failed.') }
  }
}

function paths(changes: readonly AppSyncChange[]): string[] {
  return changes.map(change => change.path)
}

/* The local edits, also when the files have errors, so each error can be
   matched to the edit it belongs to. Files too malformed to compare have none. */
function localAppChanges(local: LocalAppWorkspace): string[] {
  try {
    return paths(createAppSyncPlan(local.files, local.state, local.state.baseline).localChanges)
  } catch {
    return []
  }
}

async function checkApp(directory: string, client: ApiClient | undefined): Promise<ModuleCheck> {
  let local
  try {
    local = await readLocalAppWorkspace(directory)
  } catch (error) {
    return unreadableCheck('app', error)
  }
  const { errors } = validateLocalAppWorkspace(local.files, local.state)
  const webhookFile = local.webhookFileExists ? local.webhookFile : undefined
  const state = await withDigest({ errors, localChanges: localAppChanges(local) }, [
    local.appFile,
    webhookFile,
    local.stateFile
  ])
  return compared(emptyCheck('app', state), client, async signedIn => {
    const { plan, remoteVersion } = await loadRemoteAppSyncContext(directory, signedIn)
    /* Conflicts are reported on their own, not again as validation errors. */
    const validation = validateSyncPlan(plan, remoteVersion).errors.filter(error => !error.startsWith('Conflict at '))
    return {
      errors: [...validation, ...(await validateDynamicAuthConfiguration(signedIn, plan))],
      localChanges: paths(plan.localChanges),
      portalChanges: paths(plan.remoteChanges),
      conflicts: paths(plan.conflicts),
      operations: [...plan.sections],
      changeDetails: appChangeDetails(plan)
    }
  })
}

function planChanges(plan: WorkflowResourcePlan): ComparedState {
  return {
    errors: plan.errors,
    localChanges: plan.localChanges,
    portalChanges: plan.remoteChanges,
    conflicts: plan.conflicts,
    operations: plan.operations.map(workflowOperationLabel)
  }
}

/* Header secrets the planned creates and updates would send somewhere new. */
function secretTargets<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(resource: WorkflowResource<M, P, W, F, S>, local: M, remote: M, plan: P): string[] {
  const keys = new Set(plan.operations.filter(operation => operation.type !== 'delete').map(operation => operation.key))
  const remoteItems = resource.items(remote)
  return resource
    .items(local)
    .filter(item => keys.has(item.key))
    .flatMap(item => {
      const current = remoteItems.find(candidate => candidate.key === item.key)
      return item.versions.flatMap(version =>
        workflowSecretsToNewTargets(
          version,
          current?.versions.find(candidate => candidate.version === version.version)
        ).map(use => describeSecretUse(`${resource.singular} ${item.key} ${version.version}`, use))
      )
    })
}

async function checkWorkflowModule<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  name: 'actions' | 'triggers',
  resource: WorkflowResource<M, P, W, F, S>,
  loadIfPresent: (directory: string) => Promise<W | undefined>,
  sourceFiles: (workspace: W) => string[],
  directory: string,
  client: ApiClient | undefined
): Promise<ModuleCheck | undefined> {
  let workspace: W | undefined
  try {
    workspace = await loadIfPresent(directory)
  } catch (error) {
    return unreadableCheck(name, error)
  }
  if (!workspace) return undefined
  const { baseline } = workspace.state
  const errors = [...resource.validateManifest(workspace.manifest), ...resource.prerequisiteErrors(workspace)]
  const offline = resource.planSync(baseline, workspace.manifest, baseline, workspace).localChanges
  const state = await withDigest({ errors, localChanges: offline }, sourceFiles(workspace))
  const local = emptyCheck(name, state, resource.items(workspace.manifest).length)
  return compared(local, client, async signedIn => {
    const context = await loadWorkflowSyncContext(resource, directory, { client: signedIn })
    const { plan } = context
    return {
      ...planChanges(plan),
      secretTargets: secretTargets(resource, context.local.manifest, context.remote, plan)
    }
  })
}

const BILLING_BLOCKED =
  'Not validated: billing reads the workflow action and trigger files, which must load first (see their errors).'

async function workflowFilesLoad(directory: string): Promise<boolean> {
  return Promise.all([
    loadWorkflowActionsWorkspaceIfPresent(directory),
    loadWorkflowTriggersWorkspaceIfPresent(directory)
  ]).then(
    () => true,
    () => false
  )
}

/* Billing validation reads the workflow files; when those cannot load, their
   own module reports why, so billing says it is blocked instead of repeating. */
async function billingErrors(workspace: BillingWorkspace): Promise<string[]> {
  try {
    return await validateLocalBillingIntent(workspace)
  } catch (error) {
    return (await workflowFilesLoad(workspace.directory)) ? errorItems(error) : [BILLING_BLOCKED]
  }
}

function billingItems(workspace: BillingWorkspace): number {
  return workspace.subscriptions.plans.length + workspace.usage.meters.length
}

function prefixed(subscription: readonly string[], usage: readonly string[]): string[] {
  return [...subscription.map(path => `subscription.${path}`), ...usage.map(path => `usage.${path}`)]
}

async function checkBilling(directory: string, client: ApiClient | undefined): Promise<ModuleCheck | undefined> {
  let workspace: BillingWorkspace | undefined
  try {
    workspace = await loadBillingWorkspaceIfPresent(directory)
  } catch (error) {
    return unreadableCheck('billing', error)
  }
  if (!workspace) return undefined
  const { subscriptionBaseline, usageBaseline } = workspace.state
  const state = {
    errors: await billingErrors(workspace),
    localChanges: prefixed(
      planBillingSubscriptionSync(subscriptionBaseline, workspace.subscriptions, subscriptionBaseline).localChanges,
      planBillingUsageSync(usageBaseline, workspace.usage, usageBaseline).localChanges
    )
  }
  const files = [workspace.subscriptionFile, workspace.usageFile, workspace.stateFile]
  const local = emptyCheck('billing', await withDigest(state, files), billingItems(workspace))
  return compared(local, client, async signedIn => {
    const { subscriptionPlan, usagePlan } = await loadBillingSyncContext(directory, signedIn)
    return {
      errors: [...new Set([...subscriptionPlan.errors, ...usagePlan.errors])],
      localChanges: prefixed(subscriptionPlan.localChanges, usagePlan.localChanges),
      portalChanges: prefixed(subscriptionPlan.remoteChanges, usagePlan.remoteChanges),
      conflicts: [...subscriptionPlan.conflicts, ...usagePlan.conflicts],
      operations: [
        ...subscriptionPlan.operations.map(billingSubscriptionOperationLabel),
        ...usagePlan.operations.map(billingUsageOperationLabel)
      ]
    }
  })
}

/* Validates every module of an app workspace and, with a signed-in client,
   compares each with the portal: what push would change, what changed in the
   portal since the last pull, and where both changed the same field. */
export async function checkWorkspace(
  binding: { directory: string; appId: string; versionId: string },
  client?: ApiClient
): Promise<WorkspaceCheck> {
  const { directory } = binding
  /* Resolve the developer account once, before the modules share the client;
     without it the check still validates the local files. */
  let remoteError: string | undefined
  const signedIn = client
    ? await client.ensureTeam().then(
        () => client,
        (error: unknown) => {
          remoteError = errorMessage(error, 'The developer account could not be resolved.')
          return undefined
        }
      )
    : undefined
  const modules = await Promise.all([
    checkWorkflowModule(
      'actions',
      WORKFLOW_ACTIONS_RESOURCE,
      loadWorkflowActionsWorkspaceIfPresent,
      actionSourceFiles,
      directory,
      signedIn
    ),
    checkWorkflowModule(
      'triggers',
      WORKFLOW_TRIGGERS_RESOURCE,
      loadWorkflowTriggersWorkspaceIfPresent,
      triggerSourceFiles,
      directory,
      signedIn
    ),
    checkBilling(directory, signedIn),
    checkApp(directory, signedIn)
  ])
  const present = modules.filter((module): module is ModuleCheck => module !== undefined)
  const check = {
    ...binding,
    compared: signedIn !== undefined,
    ...(remoteError ? { remoteError } : {}),
    modules: present
  }
  const planId = pushPlanId(check)
  return planId ? { ...check, planId } : check
}

function actionSourceFiles(workspace: WorkflowActionsWorkspace): string[] {
  return [...workspace.actionFiles, ...workspace.codeFiles, workspace.stateFile]
}

function triggerSourceFiles(workspace: WorkflowTriggersWorkspace): string[] {
  return [...workspace.triggerFiles, workspace.stateFile]
}

/* A plan exists only for a valid, conflict-free workspace compared with the
   portal that has something to push. Its id covers the source files and the
   portal state, so any change after review yields a different id. */
export function pushPlanId(check: Omit<WorkspaceCheck, 'planId'>): string | undefined {
  const blocked = check.modules.some(
    module => module.errors.length > 0 || module.conflicts.length > 0 || module.remoteError
  )
  const pending = check.modules.some(module => module.localChanges.length > 0)
  if (!check.compared || blocked || !pending) return undefined
  const subject = check.modules.map(module => [
    module.name,
    module.sourceDigest,
    module.operations,
    module.portalChanges,
    module.secretTargets
  ])
  return createHash('sha256')
    .update(JSON.stringify([check.appId, check.versionId, subject]))
    .digest('hex')
    .slice(0, PLAN_ID_LENGTH)
}
