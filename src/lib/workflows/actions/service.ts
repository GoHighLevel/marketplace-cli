import { type WorkflowActionConfig, type WorkflowActionSummary } from '../../api/client.js'
import {
  buildWorkflowActionsManifest,
  redactWorkflowActionVersion,
  type WorkflowActionsManifest,
  type WorkflowActionVersion,
  toWorkflowActionUpdateBody
} from './manifest.js'
import { validateWorkflowActionsManifest } from './schema.js'
import {
  type CreateWorkflowActionOperation,
  type WorkflowActionsSyncPlan,
  type WorkflowActionSyncOperation
} from './sync.js'
import { isWorkflowActionSecretReference } from './secrets.js'
import { canonicalWorkflowConfig } from '../shared/verification.js'

export interface WorkflowActionsApi {
  listWorkflowActionSummaries(appId: string): Promise<WorkflowActionSummary[]>
  listWorkflowActionConfigs(appId: string): Promise<WorkflowActionConfig[]>
  getWorkflowActionConfigs(appId: string, templateId: string, version?: string): Promise<WorkflowActionConfig[]>
  checkWorkflowActionKeyAvailability(appId: string, key: string): Promise<boolean>
  createWorkflowAction(
    appId: string,
    body: { name: string; key: string; version: string }
  ): Promise<WorkflowActionSummary>
  updateWorkflowActionConfig(appId: string, templateId: string, body: unknown): Promise<void>
  updateWorkflowActionSummary(
    appId: string,
    templateId: string,
    body: { name?: string; version?: string; status?: string; isHidden?: boolean }
  ): Promise<WorkflowActionSummary>
  deleteWorkflowAction(appId: string, templateId: string): Promise<void>
}

export interface WorkflowActionsSnapshot {
  manifest: WorkflowActionsManifest
  runtime: WorkflowActionsManifest
  summaries: WorkflowActionSummary[]
}

export interface WorkflowActionPublishCandidate {
  action: WorkflowActionsManifest['actions'][number]
  version: WorkflowActionVersion
  repairRegistry: boolean
}

export interface ExecuteWorkflowActionsOptions {
  environment?: NodeJS.ProcessEnv
  runtime?: WorkflowActionsManifest
}

export interface WorkflowActionOperationResult {
  operation: string
  type: WorkflowActionSyncOperation['type']
  key: string
  success: boolean
  error?: string
}

export interface WorkflowActionsExecutionResult {
  total: number
  succeeded: number
  failed: number
  applied: string[]
  results: WorkflowActionOperationResult[]
}

function configKey(config: WorkflowActionConfig): string {
  return `${config.templateId}:${config.version}`
}

function meaningfulCreateBody(version: WorkflowActionVersion): boolean {
  if (Object.keys(version.info).some(key => key !== 'name')) return true
  if ((version.inputs?.length ?? 0) > 0 || (version.customVars?.length ?? 0) > 0) return true
  if (version.customVarsJson && Object.keys(version.customVarsJson).length > 0) return true
  if (version.executionConfig) return true
  if (version.payloadCustomizationType === 'custom') return true
  if (version.customizedPayload && Object.keys(version.customizedPayload).length > 0) return true
  if (version.branchesConfig && Object.keys(version.branchesConfig).length > 0) return true
  if ((version.sectionOrder?.length ?? 0) > 0) return true
  return Boolean(version.groupConfigs && Object.keys(version.groupConfigs).length > 0)
}

function createDraft(operation: CreateWorkflowActionOperation): WorkflowActionVersion {
  const draft = operation.desired.versions.find(version => version.status === 'draft')
  if (!draft) throw new Error(`Workflow action "${operation.key}" does not contain a draft version.`)
  return draft
}

export async function fetchWorkflowActionsSnapshot(
  client: WorkflowActionsApi,
  appId: string
): Promise<WorkflowActionsSnapshot> {
  const summaries = await client.listWorkflowActionSummaries(appId)
  const summaryIds = new Set<string>()
  for (const summary of summaries) {
    if (summaryIds.has(summary.actionId)) {
      throw new Error(`Workflow action registry returned duplicate action id "${summary.actionId}".`)
    }
    summaryIds.add(summary.actionId)
  }
  const bulkConfigs = summaries.length > 0 ? await client.listWorkflowActionConfigs(appId) : []
  const orphanConfigs = bulkConfigs.filter(config => !summaryIds.has(config.templateId))
  if (orphanConfigs.length > 0) {
    throw new Error(
      `Workflow action configuration ${[...new Set(orphanConfigs.map(config => config.templateId))].join(', ')} ` +
        'is missing from the OAuth registry. Repair or delete the orphaned action before pulling.'
    )
  }
  const configs = bulkConfigs.filter(config => summaryIds.has(config.templateId))
  const configVersions = new Set(configs.map(configKey))
  const missing = summaries.filter(summary => !configVersions.has(`${summary.actionId}:${summary.version}`))
  const recovered = await Promise.all(
    missing.map(summary => client.getWorkflowActionConfigs(appId, summary.actionId, summary.version))
  )
  configs.push(...recovered.flat())

  const recoveredVersions = new Set(configs.map(configKey))
  const stillMissing = summaries.filter(summary => !recoveredVersions.has(`${summary.actionId}:${summary.version}`))
  if (stillMissing.length > 0) {
    throw new Error(
      `Workflow action registry contains ${stillMissing.map(summary => `${summary.actionId}@${summary.version}`).join(', ')}, ` +
        'but the workflow service returned no configuration. Retry the pull; if it persists, repair the action in the developer portal.'
    )
  }
  const unique = new Set<string>()
  for (const config of configs) {
    if (config.appId !== appId)
      throw new Error(`Workflow action ${config.templateId} belongs to app "${config.appId}", not "${appId}".`)
    const key = configKey(config)
    if (unique.has(key)) throw new Error(`Workflow action service returned duplicate ${key}.`)
    unique.add(key)
  }
  const manifest = buildWorkflowActionsManifest(appId, configs)
  const errors = validateWorkflowActionsManifest(manifest)
  if (errors.length > 0) {
    throw new Error(`Workflow action API returned unsupported configuration:\n- ${errors.join('\n- ')}`)
  }
  return {
    manifest,
    runtime: buildWorkflowActionsManifest(appId, configs, { redactSecrets: false }),
    summaries
  }
}

export async function fetchWorkflowActionsManifest(
  client: WorkflowActionsApi,
  appId: string
): Promise<WorkflowActionsManifest> {
  return (await fetchWorkflowActionsSnapshot(client, appId)).manifest
}

export function workflowActionPublishCandidates(
  manifest: WorkflowActionsManifest,
  summaries: WorkflowActionSummary[],
  requestedVersion?: string
): WorkflowActionPublishCandidate[] {
  const summariesByTemplate = new Map(summaries.map(summary => [summary.actionId, summary]))
  const candidates: WorkflowActionPublishCandidate[] = []
  for (const action of manifest.actions) {
    const draft = action.versions.find(
      version => version.status === 'draft' && (!requestedVersion || version.version === requestedVersion)
    )
    if (draft) {
      candidates.push({ action, version: draft, repairRegistry: false })
      continue
    }
    if (!action.templateId) continue
    const published = action.versions.find(
      version => version.status === 'published' && (!requestedVersion || version.version === requestedVersion)
    )
    const summary = summariesByTemplate.get(action.templateId)
    if (!published || !summary) continue
    const approved = ['approved', 'published'].includes(summary.status.toLowerCase())
    const registryMatches = summary.version === published.version && approved && summary.isActive !== false
    if (!registryMatches) candidates.push({ action, version: published, repairRegistry: true })
  }
  return candidates
}

export function workflowActionOperationLabel(operation: WorkflowActionSyncOperation): string {
  return operation.type === 'update'
    ? `update:${operation.key}@${operation.version}`
    : `${operation.type}:${operation.key}`
}

function assertExecutablePlan(plan: WorkflowActionsSyncPlan): void {
  if (plan.errors.length > 0) throw new Error(`Workflow action push is invalid:\n- ${plan.errors.join('\n- ')}`)
  if (plan.conflicts.length > 0) {
    throw new Error(
      `Workflow action push has portal conflicts:\n- ${plan.conflicts.join('\n- ')}\nPull and reapply the local changes.`
    )
  }
}

function prepareWorkflowActionBodies(
  plan: WorkflowActionsSyncPlan,
  options: ExecuteWorkflowActionsOptions
): Map<WorkflowActionSyncOperation, ReturnType<typeof toWorkflowActionUpdateBody>> {
  const environment = options.environment ?? process.env
  const bodies = new Map<WorkflowActionSyncOperation, ReturnType<typeof toWorkflowActionUpdateBody>>()
  for (const operation of plan.operations) {
    if (operation.type === 'delete') continue
    if (operation.type === 'create') {
      const desired = createDraft(operation)
      if (meaningfulCreateBody(desired)) {
        bodies.set(
          operation,
          toWorkflowActionUpdateBody(
            desired,
            { version: '1.0', status: 'draft', info: { name: desired.info.name } },
            environment
          )
        )
      }
      continue
    }
    const runtimeCurrent = options.runtime?.actions
      .find(action => action.key === operation.key)
      ?.versions.find(version => version.version === operation.version)
    bodies.set(
      operation,
      toWorkflowActionUpdateBody(operation.desired, runtimeCurrent ?? operation.current, environment)
    )
  }
  return bodies
}

async function createAvailabilityErrors(
  client: WorkflowActionsApi,
  plan: WorkflowActionsSyncPlan
): Promise<Map<WorkflowActionSyncOperation, string>> {
  const creates = plan.operations.filter(
    (operation): operation is CreateWorkflowActionOperation => operation.type === 'create'
  )
  const checks = await Promise.allSettled(
    creates.map(operation => client.checkWorkflowActionKeyAvailability(plan.appId, operation.key))
  )
  const errors = new Map<WorkflowActionSyncOperation, string>()
  checks.forEach((check, index) => {
    const operation = creates[index]
    if (check.status === 'rejected') {
      errors.set(
        operation,
        check.reason instanceof Error ? check.reason.message : 'Action key availability check failed.'
      )
    } else if (!check.value) {
      errors.set(
        operation,
        `Workflow action key "${operation.key}" is no longer available. Pull and choose a different key.`
      )
    }
  })
  return errors
}

async function executeWorkflowActionOperation(
  client: WorkflowActionsApi,
  appId: string,
  operation: WorkflowActionSyncOperation,
  bodies: Map<WorkflowActionSyncOperation, ReturnType<typeof toWorkflowActionUpdateBody>>
): Promise<void> {
  if (operation.type === 'delete') {
    await client.deleteWorkflowAction(appId, operation.templateId)
    return
  }
  if (operation.type === 'create') {
    const desired = createDraft(operation)
    const created = await client.createWorkflowAction(appId, {
      name: desired.info.name,
      key: operation.key,
      version: '1.0'
    })
    if (meaningfulCreateBody(desired)) {
      const body = bodies.get(operation)
      if (!body) throw new Error(`Workflow action create:${operation.key} was not prepared for mutation.`)
      await client.updateWorkflowActionConfig(appId, created.actionId, body)
    }
    return
  }
  if (operation.updateSummary) {
    await client.updateWorkflowActionSummary(appId, operation.templateId, {
      name: operation.desired.info.name
    })
  }
  const body = bodies.get(operation)
  if (!body) throw new Error(`Workflow action update:${operation.key} was not prepared for mutation.`)
  await client.updateWorkflowActionConfig(appId, operation.templateId, body)
}

export async function executeWorkflowActionsSyncPlanIndependently(
  client: WorkflowActionsApi,
  plan: WorkflowActionsSyncPlan,
  options: ExecuteWorkflowActionsOptions = {}
): Promise<WorkflowActionsExecutionResult> {
  assertExecutablePlan(plan)
  const bodies = prepareWorkflowActionBodies(plan, options)
  const availabilityErrors = await createAvailabilityErrors(client, plan)
  const results: WorkflowActionOperationResult[] = []

  for (const operation of plan.operations) {
    const operationLabel = workflowActionOperationLabel(operation)
    const availabilityError = availabilityErrors.get(operation)
    if (availabilityError) {
      results.push({
        operation: operationLabel,
        type: operation.type,
        key: operation.key,
        success: false,
        error: availabilityError
      })
      continue
    }
    try {
      await executeWorkflowActionOperation(client, plan.appId, operation, bodies)
      results.push({ operation: operationLabel, type: operation.type, key: operation.key, success: true })
    } catch (error) {
      results.push({
        operation: operationLabel,
        type: operation.type,
        key: operation.key,
        success: false,
        error: error instanceof Error ? error.message : 'Workflow action operation failed.'
      })
    }
  }

  const applied = results.filter(result => result.success).map(result => result.operation)
  return {
    total: results.length,
    succeeded: applied.length,
    failed: results.length - applied.length,
    applied,
    results
  }
}

export async function executeWorkflowActionsSyncPlan(
  client: WorkflowActionsApi,
  plan: WorkflowActionsSyncPlan,
  options: ExecuteWorkflowActionsOptions = {}
): Promise<string[]> {
  const result = await executeWorkflowActionsSyncPlanIndependently(client, plan, options)
  if (result.failed > 0) {
    const failures = result.results
      .filter(item => !item.success)
      .map(item => `${item.operation}: ${item.error ?? 'unknown failure'}`)
    throw new Error(`Workflow action push failed:\n- ${failures.join('\n- ')}`)
  }
  return result.applied
}

export function reconcileWorkflowActionsAfterPush(
  local: WorkflowActionsManifest,
  remote: WorkflowActionsManifest,
  failedKeys: Set<string>
): WorkflowActionsManifest {
  const localActions = new Map(local.actions.map(action => [action.key, action]))
  const remoteActions = new Map(remote.actions.map(action => [action.key, action]))
  const actions: WorkflowActionsManifest['actions'] = []
  const keys = [...new Set([...localActions.keys(), ...remoteActions.keys()])].sort()

  for (const key of keys) {
    const desired = localActions.get(key)
    const current = remoteActions.get(key)
    if (!failedKeys.has(key)) {
      if (current) actions.push(structuredClone(current))
      continue
    }
    if (!desired) continue
    actions.push({
      ...structuredClone(desired),
      ...(current?.templateId ? { templateId: current.templateId } : {})
    })
  }
  return { schemaVersion: 1, appId: remote.appId, actions }
}

function sameConfig(left: WorkflowActionVersion, right: WorkflowActionVersion): boolean {
  const options = { isSecretReference: isWorkflowActionSecretReference }
  return (
    JSON.stringify(canonicalWorkflowConfig(redactWorkflowActionVersion(left), options)) ===
    JSON.stringify(canonicalWorkflowConfig(redactWorkflowActionVersion(right), options))
  )
}

export function verifyWorkflowActionsApplied(plan: WorkflowActionsSyncPlan, remote: WorkflowActionsManifest): string[] {
  const mismatches: string[] = []
  for (const operation of plan.operations) {
    const action = remote.actions.find(candidate => candidate.key === operation.key)
    if (operation.type === 'delete') {
      if (action) mismatches.push(`delete:${operation.key}`)
      continue
    }
    const desired =
      operation.type === 'create'
        ? operation.desired.versions.find(version => version.status === 'draft')
        : operation.desired
    const actual = desired && action?.versions.find(version => version.version === desired.version)
    if (!desired || !actual || !sameConfig(desired, actual)) {
      mismatches.push(
        operation.type === 'create' ? `create:${operation.key}` : `update:${operation.key}@${operation.version}`
      )
    }
  }
  return mismatches
}
