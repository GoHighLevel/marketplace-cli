import { errorMessage } from '../../shared/errors.js'
import { type WorkflowTriggerConfig, type WorkflowTriggerSummary } from '../../api/client.js'
import {
  buildWorkflowTriggersManifest,
  type WorkflowTriggersManifest,
  type WorkflowTriggerVersion,
  toWorkflowTriggerUpdateBody
} from './manifest.js'
import { validateWorkflowTriggersManifest } from './schema.js'
import { isWorkflowSecretReference } from '../shared/secret-references.js'
import { canonicalWorkflowConfig } from '../shared/verification.js'
import {
  type CreateWorkflowTriggerOperation,
  type WorkflowTriggersSyncPlan,
  type WorkflowTriggerSyncOperation
} from './sync.js'

export interface WorkflowTriggersApi {
  listWorkflowTriggerSummaries(appId: string): Promise<WorkflowTriggerSummary[]>
  listWorkflowTriggerConfigs(appId: string): Promise<WorkflowTriggerConfig[]>
  getWorkflowTriggerConfigs(appId: string, templateId: string, version?: string): Promise<WorkflowTriggerConfig[]>
  checkWorkflowTriggerKeyAvailability(appId: string, key: string): Promise<boolean>
  createWorkflowTrigger(
    appId: string,
    body: { name: string; key: string; version: string }
  ): Promise<WorkflowTriggerSummary>
  createWorkflowTriggerVersion(appId: string, templateId: string): Promise<WorkflowTriggerSummary>
  updateWorkflowTriggerConfig(appId: string, templateId: string, body: unknown): Promise<void>
  updateWorkflowTriggerSummary(
    appId: string,
    templateId: string,
    body: { name?: string; version?: string; status?: string }
  ): Promise<WorkflowTriggerSummary>
  deleteWorkflowTrigger(appId: string, templateId: string): Promise<void>
}

export interface WorkflowTriggersSnapshot {
  manifest: WorkflowTriggersManifest
  runtime: WorkflowTriggersManifest
  summaries: WorkflowTriggerSummary[]
}

export interface ExecuteWorkflowTriggersOptions {
  environment?: NodeJS.ProcessEnv
  runtime?: WorkflowTriggersManifest
}

export interface WorkflowTriggerPublishCandidate {
  trigger: WorkflowTriggersManifest['triggers'][number]
  version: WorkflowTriggerVersion
  repairRegistry: boolean
}

export interface WorkflowTriggerOperationResult {
  operation: string
  type: WorkflowTriggerSyncOperation['type']
  key: string
  success: boolean
  error?: string
}

export interface WorkflowTriggersExecutionResult {
  total: number
  succeeded: number
  failed: number
  applied: string[]
  results: WorkflowTriggerOperationResult[]
}

function configKey(config: WorkflowTriggerConfig): string {
  return `${config.templateId}:${config.version}`
}

function meaningfulCreateBody(version: WorkflowTriggerVersion): boolean {
  if (Object.keys(version.info).some(key => key !== 'name')) return true
  if ((version.filters?.length ?? 0) > 0 || (version.customVars?.length ?? 0) > 0) return true
  if (version.customVarsJson && Object.keys(version.customVarsJson).length > 0) return true
  return Boolean(version.subscriptionConfig)
}

function createDraft(operation: CreateWorkflowTriggerOperation): WorkflowTriggerVersion {
  const draft = operation.desired.versions.find(version => version.status === 'draft')
  if (!draft) throw new Error(`Workflow trigger "${operation.key}" does not contain a draft version.`)
  return draft
}

export async function fetchWorkflowTriggersSnapshot(
  client: WorkflowTriggersApi,
  appId: string
): Promise<WorkflowTriggersSnapshot> {
  const summaries = await client.listWorkflowTriggerSummaries(appId)
  const summaryIds = new Set<string>()
  for (const summary of summaries) {
    if (summaryIds.has(summary.triggerId)) {
      throw new Error(`Workflow trigger registry returned duplicate trigger id "${summary.triggerId}".`)
    }
    summaryIds.add(summary.triggerId)
  }
  const bulkConfigs = summaries.length > 0 ? await client.listWorkflowTriggerConfigs(appId) : []
  const configs = bulkConfigs.filter(config => summaryIds.has(config.templateId))
  const orphanConfigs = bulkConfigs.filter(config => !summaryIds.has(config.templateId))
  if (orphanConfigs.length > 0) {
    throw new Error(
      `Workflow trigger configuration ${[...new Set(orphanConfigs.map(config => config.templateId))].join(', ')} ` +
        'is missing from the OAuth registry. Repair or delete the orphaned trigger before pulling.'
    )
  }
  const configVersions = new Set(configs.map(configKey))
  const missing = summaries.filter(summary => !configVersions.has(`${summary.triggerId}:${summary.version}`))
  const recovered = await Promise.all(
    missing.map(summary => client.getWorkflowTriggerConfigs(appId, summary.triggerId, summary.version))
  )
  configs.push(...recovered.flat())
  const recoveredVersions = new Set(configs.map(configKey))
  const stillMissing = summaries.filter(summary => !recoveredVersions.has(`${summary.triggerId}:${summary.version}`))
  if (stillMissing.length > 0) {
    throw new Error(
      `Workflow trigger registry contains ${stillMissing.map(summary => `${summary.triggerId}@${summary.version}`).join(', ')}, ` +
        'but the workflow service returned no configuration. Retry the pull; if it persists, repair the trigger in the developer portal.'
    )
  }
  const unique = new Set<string>()
  for (const config of configs) {
    if (config.appId !== appId) {
      throw new Error(`Workflow trigger ${config.templateId} belongs to app "${config.appId}", not "${appId}".`)
    }
    const key = configKey(config)
    if (unique.has(key)) throw new Error(`Workflow trigger service returned duplicate ${key}.`)
    unique.add(key)
  }
  const manifest = buildWorkflowTriggersManifest(appId, configs)
  const errors = validateWorkflowTriggersManifest(manifest)
  if (errors.length > 0) {
    throw new Error(`Workflow trigger API returned unsupported configuration:\n- ${errors.join('\n- ')}`)
  }
  return {
    manifest,
    runtime: buildWorkflowTriggersManifest(appId, configs, { redactSecrets: false }),
    summaries
  }
}

export async function fetchWorkflowTriggersManifest(
  client: WorkflowTriggersApi,
  appId: string
): Promise<WorkflowTriggersManifest> {
  return (await fetchWorkflowTriggersSnapshot(client, appId)).manifest
}

export function workflowTriggerPublishCandidates(
  manifest: WorkflowTriggersManifest,
  summaries: WorkflowTriggerSummary[],
  requestedVersion?: string
): WorkflowTriggerPublishCandidate[] {
  const summariesByTemplate = new Map(summaries.map(summary => [summary.triggerId, summary]))
  const candidates: WorkflowTriggerPublishCandidate[] = []
  for (const trigger of manifest.triggers) {
    const draft = trigger.versions.find(
      version => version.status === 'draft' && (!requestedVersion || version.version === requestedVersion)
    )
    if (draft) {
      candidates.push({ trigger, version: draft, repairRegistry: false })
      continue
    }
    if (!trigger.templateId) continue
    const published = trigger.versions.find(
      version => version.status === 'published' && (!requestedVersion || version.version === requestedVersion)
    )
    const summary = summariesByTemplate.get(trigger.templateId)
    if (!published || !summary) continue
    const approved = ['approved', 'published'].includes(summary.status?.toLowerCase() ?? '')
    const registryMatches = summary.version === published.version && approved && summary.isActive !== false
    if (!registryMatches) candidates.push({ trigger, version: published, repairRegistry: true })
  }
  return candidates
}

export function workflowTriggerOperationLabel(operation: WorkflowTriggerSyncOperation): string {
  return operation.type === 'update'
    ? `update:${operation.key}@${operation.version}`
    : `${operation.type}:${operation.key}`
}

function assertExecutablePlan(plan: WorkflowTriggersSyncPlan): void {
  if (plan.errors.length > 0) throw new Error(`Workflow trigger push is invalid:\n- ${plan.errors.join('\n- ')}`)
  if (plan.conflicts.length > 0) {
    throw new Error(
      `Workflow trigger push has portal conflicts:\n- ${plan.conflicts.join('\n- ')}\nPull and reapply the local changes.`
    )
  }
}

function prepareWorkflowTriggerBodies(
  plan: WorkflowTriggersSyncPlan,
  options: ExecuteWorkflowTriggersOptions
): Map<WorkflowTriggerSyncOperation, ReturnType<typeof toWorkflowTriggerUpdateBody>> {
  const environment = options.environment ?? process.env
  const bodies = new Map<WorkflowTriggerSyncOperation, ReturnType<typeof toWorkflowTriggerUpdateBody>>()
  for (const operation of plan.operations) {
    if (operation.type === 'delete') continue
    if (operation.type === 'create') {
      const desired = createDraft(operation)
      if (meaningfulCreateBody(desired)) {
        bodies.set(
          operation,
          toWorkflowTriggerUpdateBody(
            desired,
            { version: '1.0', status: 'draft', info: { name: desired.info.name } },
            environment
          )
        )
      }
      continue
    }
    const runtimeCurrent = options.runtime?.triggers
      .find(trigger => trigger.key === operation.key)
      ?.versions.find(version => version.version === operation.version)
    bodies.set(
      operation,
      toWorkflowTriggerUpdateBody(operation.desired, runtimeCurrent ?? operation.current, environment)
    )
  }
  return bodies
}

async function createAvailabilityErrors(
  client: WorkflowTriggersApi,
  plan: WorkflowTriggersSyncPlan
): Promise<Map<WorkflowTriggerSyncOperation, string>> {
  const creates = plan.operations.filter(
    (operation): operation is CreateWorkflowTriggerOperation => operation.type === 'create'
  )
  const checks = await Promise.allSettled(
    creates.map(operation => client.checkWorkflowTriggerKeyAvailability(plan.appId, operation.key))
  )
  const errors = new Map<WorkflowTriggerSyncOperation, string>()
  checks.forEach((check, index) => {
    const operation = creates[index]
    if (check.status === 'rejected') {
      errors.set(operation, errorMessage(check.reason, 'Trigger key availability check failed.'))
    } else if (!check.value) {
      errors.set(
        operation,
        `Workflow trigger key "${operation.key}" is no longer available. Pull and choose a different key.`
      )
    }
  })
  return errors
}

async function executeWorkflowTriggerOperation(
  client: WorkflowTriggersApi,
  appId: string,
  operation: WorkflowTriggerSyncOperation,
  bodies: Map<WorkflowTriggerSyncOperation, ReturnType<typeof toWorkflowTriggerUpdateBody>>
): Promise<void> {
  if (operation.type === 'delete') {
    await client.deleteWorkflowTrigger(appId, operation.templateId)
    return
  }
  if (operation.type === 'create') {
    const desired = createDraft(operation)
    const created = await client.createWorkflowTrigger(appId, {
      name: desired.info.name,
      key: operation.key,
      version: '1.0'
    })
    if (meaningfulCreateBody(desired)) {
      const body = bodies.get(operation)
      if (!body) throw new Error(`Workflow trigger create:${operation.key} was not prepared for mutation.`)
      await client.updateWorkflowTriggerConfig(appId, created.triggerId, body)
    }
    return
  }
  if (operation.updateSummary) {
    await client.updateWorkflowTriggerSummary(appId, operation.templateId, {
      name: operation.desired.info.name
    })
  }
  const body = bodies.get(operation)
  if (!body) throw new Error(`Workflow trigger update:${operation.key} was not prepared for mutation.`)
  await client.updateWorkflowTriggerConfig(appId, operation.templateId, body)
}

export async function executeWorkflowTriggersSyncPlanIndependently(
  client: WorkflowTriggersApi,
  plan: WorkflowTriggersSyncPlan,
  options: ExecuteWorkflowTriggersOptions = {}
): Promise<WorkflowTriggersExecutionResult> {
  assertExecutablePlan(plan)
  const bodies = prepareWorkflowTriggerBodies(plan, options)
  const unavailable = await createAvailabilityErrors(client, plan)
  const results: WorkflowTriggerOperationResult[] = []
  for (const operation of plan.operations) {
    const operationName = workflowTriggerOperationLabel(operation)
    const existingError = unavailable.get(operation)
    if (existingError) {
      results.push({
        operation: operationName,
        type: operation.type,
        key: operation.key,
        success: false,
        error: existingError
      })
      continue
    }
    try {
      await executeWorkflowTriggerOperation(client, plan.appId, operation, bodies)
      results.push({ operation: operationName, type: operation.type, key: operation.key, success: true })
    } catch (error) {
      results.push({
        operation: operationName,
        type: operation.type,
        key: operation.key,
        success: false,
        error: errorMessage(error, 'Unknown error')
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

export function reconcileWorkflowTriggersAfterPush(
  local: WorkflowTriggersManifest,
  remote: WorkflowTriggersManifest,
  failedKeys: Set<string>
): WorkflowTriggersManifest {
  const localTriggers = new Map(local.triggers.map(trigger => [trigger.key, trigger]))
  const remoteTriggers = new Map(remote.triggers.map(trigger => [trigger.key, trigger]))
  const triggers: WorkflowTriggersManifest['triggers'] = []
  const keys = [...new Set([...localTriggers.keys(), ...remoteTriggers.keys()])].sort()
  for (const key of keys) {
    const desired = localTriggers.get(key)
    const current = remoteTriggers.get(key)
    if (!failedKeys.has(key)) {
      if (current) triggers.push(structuredClone(current))
      continue
    }
    if (!desired) continue
    triggers.push({
      ...structuredClone(desired),
      ...(current?.templateId ? { templateId: current.templateId } : {})
    })
  }
  return { schemaVersion: 1, appId: remote.appId, triggers }
}

function sameConfig(left: WorkflowTriggerVersion, right: WorkflowTriggerVersion): boolean {
  const options = { ignoredKeys: ['sampleResponseJson'], isSecretReference: isWorkflowSecretReference }
  return (
    JSON.stringify(canonicalWorkflowConfig(left, options)) === JSON.stringify(canonicalWorkflowConfig(right, options))
  )
}

export function verifyWorkflowTriggersApplied(
  plan: WorkflowTriggersSyncPlan,
  remote: WorkflowTriggersManifest
): string[] {
  const mismatches: string[] = []
  for (const operation of plan.operations) {
    const label = workflowTriggerOperationLabel(operation)
    if (operation.type === 'delete') {
      if (remote.triggers.some(trigger => trigger.key === operation.key)) mismatches.push(label)
      continue
    }
    const trigger = remote.triggers.find(item => item.key === operation.key)
    if (!trigger) {
      mismatches.push(label)
      continue
    }
    const version =
      operation.type === 'create'
        ? trigger.versions.find(item => item.version === createDraft(operation).version)
        : trigger.versions.find(item => item.version === operation.version)
    if (!version) {
      mismatches.push(label)
      continue
    }
    const desired = operation.type === 'create' ? createDraft(operation) : operation.desired
    if (!sameConfig(version, desired)) mismatches.push(label)
  }
  return mismatches
}
