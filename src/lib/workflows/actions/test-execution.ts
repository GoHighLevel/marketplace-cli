import type {
  WorkflowActionTestRequest,
  WorkflowActionTestResponse
} from '../../api/client.js'
import { isRecord } from '../../api/response.js'
import {
  toWorkflowActionUpdateBody,
  WorkflowActionExecutionType,
  WorkflowActionVersion
} from './manifest.js'

export interface PrepareWorkflowActionTestOptions {
  appId: string
  inputData: Record<string, unknown>
  locationId?: string
  version: WorkflowActionVersion
  remoteVersion?: WorkflowActionVersion
  environment?: NodeJS.ProcessEnv
}

function errorDetails(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return 'Unknown execution error'
    return serialized.length > 2_000 ? `${serialized.slice(0, 2_000)}…` : serialized
  } catch {
    return 'Unknown execution error'
  }
}

export function prepareWorkflowActionTestRequest(
  options: PrepareWorkflowActionTestOptions
): WorkflowActionTestRequest {
  if (!options.version.executionConfig) {
    throw new Error(`Workflow action version ${options.version.version} has no executionConfig to test.`)
  }
  const body = toWorkflowActionUpdateBody(
    options.version,
    options.remoteVersion,
    options.environment
  )
  const execution = body.executionConfig
  if (!execution) throw new Error(`Workflow action version ${options.version.version} has no executionConfig to test.`)
  const headers = Object.entries(execution.headers ?? {}).map(([label, key]) => ({ label, key }))
  const { pauseExecution: _pauseExecution, headers: _headers, ...testExecution } = execution
  const inputData = structuredClone(options.inputData)
  const configuredBranches = options.version.branchesConfig?.predefinedBranches?.branches ?? []
  if (configuredBranches.length > 0) {
    if (Object.hasOwn(inputData, 'branches')) {
      throw new Error('Workflow action test input cannot define reserved field "branches".')
    }
    inputData.branches = configuredBranches.map(branch => ({
      id: branch.id,
      name: branch.branchName,
      fields: structuredClone(branch.fields),
      ...(branch.meta ? { meta: structuredClone(branch.meta) } : {})
    }))
  }

  return {
    appId: options.appId,
    inputData,
    ...(options.locationId ? { locationId: options.locationId } : {}),
    executionConfig: { ...testExecution, headers }
  }
}

export function assertWorkflowActionTestSucceeded(
  response: WorkflowActionTestResponse,
  executionType: WorkflowActionExecutionType
): WorkflowActionTestResponse {
  if (response.hasError) {
    throw new Error(`Workflow action test failed: ${errorDetails(response.errorMessage)}`)
  }
  if (executionType === 'CODE' && !Array.isArray(response.output) && !isRecord(response.output)) {
    throw new Error('Workflow action code output must be a JavaScript object or array.')
  }
  return response
}
