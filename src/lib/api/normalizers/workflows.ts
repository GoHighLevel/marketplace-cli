import { hasOptionalBooleanFields, hasOptionalStringFields, isStringArray } from './fields.js'
import { isRecord } from '../response.js'
import type {
  WorkflowActionConfig,
  WorkflowActionSummary,
  WorkflowActionTestResponse,
  WorkflowTriggerConfig,
  WorkflowTriggerSummary
} from '../types.js'

export function isWorkflowActionSummary(value: unknown): value is WorkflowActionSummary {
  return (
    isRecord(value) &&
    typeof value._id === 'string' &&
    value._id.length > 0 &&
    typeof value.actionId === 'string' &&
    value.actionId.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.status === 'string' &&
    value.status.length > 0 &&
    hasOptionalBooleanFields(value, ['isHidden', 'isActive'])
  )
}

function isWorkflowActionConfig(value: unknown): value is WorkflowActionConfig {
  return (
    isRecord(value) &&
    typeof value.templateId === 'string' &&
    value.templateId.length > 0 &&
    typeof value.appId === 'string' &&
    value.appId.length > 0 &&
    typeof value.key === 'string' &&
    value.key.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.status === 'string' &&
    value.status.length > 0 &&
    isRecord(value.info) &&
    typeof value.info.name === 'string' &&
    value.info.name.trim().length > 0
  )
}

export function isWorkflowTriggerSummary(value: unknown): value is WorkflowTriggerSummary {
  return (
    isRecord(value) &&
    typeof value._id === 'string' &&
    value._id.length > 0 &&
    typeof value.triggerId === 'string' &&
    value.triggerId.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    hasOptionalStringFields(value, ['status']) &&
    hasOptionalBooleanFields(value, ['isActive'])
  )
}

function isWorkflowTriggerConfig(value: unknown): value is WorkflowTriggerConfig {
  return (
    isRecord(value) &&
    typeof value.templateId === 'string' &&
    value.templateId.length > 0 &&
    typeof value.appId === 'string' &&
    value.appId.length > 0 &&
    typeof value.key === 'string' &&
    value.key.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.status === 'string' &&
    value.status.length > 0 &&
    isRecord(value.info) &&
    typeof value.info.name === 'string' &&
    value.info.name.trim().length > 0
  )
}

export function workflowActionConfigs(response: unknown, label: string): WorkflowActionConfig[] {
  if (!isRecord(response) || !Array.isArray(response.actions) || !response.actions.every(isWorkflowActionConfig)) {
    throw new Error(`${label} API returned an unexpected response.`)
  }
  return response.actions
}

export function workflowTriggerConfigs(response: unknown, label: string): WorkflowTriggerConfig[] {
  if (!isRecord(response) || !Array.isArray(response.triggers) || !response.triggers.every(isWorkflowTriggerConfig)) {
    throw new Error(`${label} API returned an unexpected response.`)
  }
  return response.triggers
}

export async function recoverCreatedWorkflowVersion<T>(
  loadConfigs: () => Promise<Array<WorkflowActionConfig | WorkflowTriggerConfig>>,
  templateId: string,
  toSummary: (draft: WorkflowActionConfig | WorkflowTriggerConfig) => T
): Promise<T | undefined> {
  try {
    const draft = (await loadConfigs()).find(
      config => config.templateId === templateId && config.status.toLowerCase() === 'draft'
    )
    return draft ? toSummary(draft) : undefined
  } catch {
    return undefined
  }
}

export function workflowActionTestResponse(response: unknown): WorkflowActionTestResponse {
  if (
    !isRecord(response) ||
    typeof response.hasError !== 'boolean' ||
    (response.consoleLogs !== undefined && !isStringArray(response.consoleLogs)) ||
    (!response.hasError && !Object.hasOwn(response, 'output'))
  ) {
    throw new Error('Workflow action test API returned an unexpected response.')
  }
  return response as unknown as WorkflowActionTestResponse
}
