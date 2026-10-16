import { isRecord } from '../../api/response.js'
import {
  WORKFLOW_REMOTE_REFERENCE,
  workflowEnvironmentVariable,
  workflowHeaderRequiresReference
} from './secret-references.js'

const HEADER_TRAVERSAL_BOUNDARIES = new Set(['body', 'customVarsJson', 'customizedPayload', 'meta', 'value'])

function matchingArrayItem(desired: unknown, current: unknown, index: number): unknown {
  if (!Array.isArray(current)) return undefined
  if (!isRecord(desired)) return current[index]
  for (const field of ['field', 'reference', 'id', 'branchName', 'value', 'version']) {
    const identity = desired[field]
    if (typeof identity !== 'string' && typeof identity !== 'number') continue
    const matches = current.filter(item => isRecord(item) && item[field] === identity)
    if (matches.length === 1) return matches[0]
  }
  return current[index]
}

export function redactWorkflowHeaders<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactWorkflowHeaders) as T
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (HEADER_TRAVERSAL_BOUNDARIES.has(key)) {
      result[key] = structuredClone(child)
    } else if (key === 'headers' && isRecord(child)) {
      result[key] = Object.fromEntries(
        Object.entries(child).map(([name, headerValue]) => [
          name,
          typeof headerValue === 'string' && headerValue && workflowHeaderRequiresReference(name)
            ? WORKFLOW_REMOTE_REFERENCE
            : structuredClone(headerValue)
        ])
      )
    } else {
      result[key] = redactWorkflowHeaders(child)
    }
  }
  return result as T
}

function hydrateHeaderValue(
  value: string,
  current: unknown,
  path: string,
  environment: NodeJS.ProcessEnv,
  resource: 'action' | 'trigger'
): string {
  if (value === WORKFLOW_REMOTE_REFERENCE) {
    if (typeof current !== 'string' || !current) {
      throw new Error(
        `${path} uses "${WORKFLOW_REMOTE_REFERENCE}", but the remote ${resource} has no value to preserve.`
      )
    }
    return current
  }
  const variable = workflowEnvironmentVariable(value)
  if (!variable) return value
  const resolved = environment[variable]
  if (!resolved) throw new Error(`${path} references unset environment variable ${variable}.`)
  return resolved
}

export function hydrateWorkflowHeaders(
  desired: unknown,
  current: unknown,
  environment: NodeJS.ProcessEnv,
  resource: 'action' | 'trigger',
  path = ''
): void {
  if (Array.isArray(desired)) {
    desired.forEach((item, index) => {
      hydrateWorkflowHeaders(item, matchingArrayItem(item, current, index), environment, resource, `${path}[${index}]`)
    })
    return
  }
  if (!isRecord(desired)) return
  const currentRecord = isRecord(current) ? current : {}
  for (const [key, child] of Object.entries(desired)) {
    const childPath = path ? `${path}.${key}` : key
    if (HEADER_TRAVERSAL_BOUNDARIES.has(key)) continue
    if (key === 'headers' && isRecord(child)) {
      const currentHeaders = isRecord(currentRecord[key]) ? currentRecord[key] : {}
      desired[key] = Object.fromEntries(
        Object.entries(child).map(([name, headerValue]) => [
          name,
          typeof headerValue === 'string'
            ? hydrateHeaderValue(headerValue, currentHeaders[name], `${childPath}.${name}`, environment, resource)
            : headerValue
        ])
      )
    } else {
      hydrateWorkflowHeaders(child, currentRecord[key], environment, resource, childPath)
    }
  }
}

export interface WorkflowSecretUse {
  /* Dotted path of the header inside the item version. */
  header: string
  /* `env NAME` for a local environment variable, or `stored secret`. */
  source: string
  /* Where the request carrying the header goes; undefined when unknown. */
  url?: string
}

function secretSource(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value === WORKFLOW_REMOTE_REFERENCE) return 'stored secret'
  const variable = workflowEnvironmentVariable(value)
  return variable ? `env ${variable}` : undefined
}

/* Header secrets that a push or test would send somewhere the portal does
   not send them today: any secret reference whose request URL differs from
   the current portal configuration (including a request that is new). */
export function workflowSecretsToNewTargets(desired: unknown, current: unknown, path = ''): WorkflowSecretUse[] {
  if (Array.isArray(desired)) {
    return desired.flatMap((item, index) =>
      workflowSecretsToNewTargets(item, matchingArrayItem(item, current, index), `${path}[${index}]`)
    )
  }
  if (!isRecord(desired)) return []
  const currentRecord = isRecord(current) ? current : {}
  return Object.entries(desired).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key
    if (HEADER_TRAVERSAL_BOUNDARIES.has(key)) return []
    if (key !== 'headers' || !isRecord(child)) {
      return workflowSecretsToNewTargets(child, currentRecord[key], childPath)
    }
    const url = typeof desired.url === 'string' ? desired.url : undefined
    const currentUrl = typeof currentRecord.url === 'string' ? currentRecord.url : undefined
    if (isRecord(currentRecord[key]) && url === currentUrl) return []
    return Object.entries(child).flatMap(([name, value]) => {
      const source = secretSource(value)
      return source ? [{ header: `${childPath}.${name}`, source, ...(url ? { url } : {}) }] : []
    })
  })
}

export function describeSecretUse(owner: string, use: WorkflowSecretUse): string {
  return `${owner} header ${use.header} (${use.source}) -> ${use.url ?? 'a request without a URL'}`
}
