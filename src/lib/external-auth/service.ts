import { isRecord, sanitizeTerminalText } from '../api/response.js'
import { valuesEqual } from '../shared/three-way-diff.js'
import {
  buildExternalAuthManifest,
  ExternalAuthApiResponse,
  ExternalAuthCapabilityLocks,
  ExternalAuthField,
  ExternalAuthManifest,
  externalAuthCapabilityLocks
} from './manifest.js'

interface ExternalAuthReadClient {
  getExternalAuthConfig(appId: string, versionId: string): Promise<unknown>
}

interface ExternalAuthTestResultClient {
  getExternalAuthTestResult(appId: string, testId: string): Promise<unknown>
}

interface ExternalAuthLineageClient extends ExternalAuthReadClient {
  listVersions(appId: string): Promise<Array<{ _id: string; status?: string }>>
}

export interface ExternalAuthSnapshot {
  manifest: ExternalAuthManifest
  raw: ExternalAuthApiResponse
}

export interface ExternalAuthPollOptions {
  timeoutMs?: number
  intervalMs?: number
  wait?: (milliseconds: number) => Promise<void>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_TEST_VALUE_LENGTH = 10_000
const MAX_STATE_LENGTH = 16_384
const SENSITIVE_OUTPUT_KEY = /(?:authorization|cookie|credential|password|passwd|secret|token|api[-_]?key)/i
const DIAGNOSTIC_LOG_KEY = /^(?:consoleLogs|logs)$/i
const PUBLISHED_APP_STATUSES = new Set(['live', 'deprecating', 'deprecated'])

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export async function fetchExternalAuthSnapshot(
  client: ExternalAuthReadClient,
  appId: string,
  versionId: string
): Promise<ExternalAuthSnapshot> {
  const response = await client.getExternalAuthConfig(appId, versionId)
  if (!isRecord(response)) throw new Error('External-auth configuration response must be an object.')
  const raw = response as ExternalAuthApiResponse
  return { raw, manifest: buildExternalAuthManifest(appId, versionId, raw) }
}

function externalAuthType(value: unknown): 'basic' | 'oauth2' | undefined {
  if (!isRecord(value)) return undefined
  const type = value.externalAuthType ??
    value.authType ??
    (isRecord(value.externalAuthConfig) ? value.externalAuthConfig.type : undefined) ??
    (isRecord(value.externalAuth) ? value.externalAuth.type : undefined)
  return type === 'basic' || type === 'oauth2' ? type : undefined
}

export async function resolveExternalAuthLocks(
  client: ExternalAuthLineageClient,
  appId: string,
  current: { versionId: string; response: ExternalAuthApiResponse; versions?: Array<{ _id: string; status?: string }> }
): Promise<ExternalAuthCapabilityLocks> {
  const serverLocks = current.response.externalAuthConfig?.capabilityLocks
  const baseLocks = externalAuthCapabilityLocks(current.response)
  if (
    serverLocks?.authTypeLocked === false ||
    (serverLocks?.authTypeLocked === true && baseLocks.lockedAuthType !== undefined)
  ) return baseLocks

  const versions = current.versions ?? await client.listVersions(appId)
  const publishedVersions = versions.filter(version =>
    PUBLISHED_APP_STATUSES.has(version.status?.toLowerCase() ?? '')
  )
  const types = await Promise.all(publishedVersions.map(async version => {
    const listedType = externalAuthType(version)
    if (listedType) return listedType
    if (version._id === current.versionId) return externalAuthType(current.response)
    try {
      return externalAuthType(await client.getExternalAuthConfig(appId, version._id))
    } catch {
      return undefined
    }
  }))
  const lockedAuthType = types.find(type => type !== undefined)
  return {
    ...baseLocks,
    authTypeLocked: lockedAuthType !== undefined,
    ...(lockedAuthType ? { lockedAuthType } : {}),
    oauth2TypeLocked: lockedAuthType === 'oauth2'
  }
}

export function validateExternalAuthTestUserData(
  fields: ExternalAuthField[],
  value: unknown
): Record<string, string> {
  if (!isRecord(value)) throw new Error('External-auth test input must be a JSON object.')
  const configured = new Map(fields.map(field => [field.key, field]))
  const result: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [key, entry] of Object.entries(value)) {
    const safeKey = sanitizeTerminalText(key)
    if (!configured.has(key)) throw new Error(`External-auth test input field "${safeKey}" is not configured.`)
    if (typeof entry !== 'string') throw new Error(`External-auth test input field "${safeKey}" must be a string.`)
    if (entry.length > MAX_TEST_VALUE_LENGTH) {
      throw new Error(`External-auth test input field "${safeKey}" must be at most ${MAX_TEST_VALUE_LENGTH.toLocaleString('en-US')} characters.`)
    }
    if (/[\u0000-\u001F\u007F-\u009F]/.test(entry)) {
      throw new Error(`External-auth test input field "${safeKey}" must not contain control characters.`)
    }
    result[key] = entry
  }
  for (const field of fields) {
    if (field.required && !result[field.key]?.trim()) {
      throw new Error(`External-auth test input field "${field.key}" is required.`)
    }
  }
  return result
}

export function externalAuthTestIdFromState(state: string): string {
  if (!state || state.length > MAX_STATE_LENGTH) throw new Error('OAuth test state is invalid.')
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as unknown
  } catch {
    throw new Error('OAuth test state is invalid.')
  }
  if (!isRecord(decoded) || typeof decoded.uuid !== 'string' || !UUID.test(decoded.uuid)) {
    throw new Error('OAuth test result id is invalid.')
  }
  return decoded.uuid
}

export async function pollExternalAuthTest(
  client: ExternalAuthTestResultClient,
  appId: string,
  testId: string,
  options: ExternalAuthPollOptions = {}
): Promise<unknown> {
  if (!UUID.test(testId)) throw new Error('OAuth test result id is invalid.')
  const timeoutMs = options.timeoutMs ?? 120_000
  const intervalMs = options.intervalMs ?? 2_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error('OAuth test timeout must be between 1 and 300,000 milliseconds.')
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > timeoutMs) {
    throw new Error('OAuth test interval must be between 1 millisecond and the timeout.')
  }
  const wait = options.wait ?? delay
  const deadline = Date.now() + timeoutMs
  do {
    const response = await client.getExternalAuthTestResult(appId, testId)
    if (isRecord(response) && response.status === 'completed' && Object.hasOwn(response, 'result')) {
      return response.result
    }
    if (isRecord(response) && response.status === 'failed') {
      throw new Error('External OAuth authentication test failed.')
    }
    if (Date.now() + intervalMs > deadline) break
    await wait(intervalMs)
  } while (Date.now() <= deadline)
  throw new Error(`External OAuth authentication test timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`)
}

export function redactExternalAuthTestOutput(value: unknown, secretValues: string[]): unknown {
  const discoveredSecrets: string[] = []
  const collectStrings = (input: unknown): void => {
    if (typeof input === 'string') {
      if (input.length >= 4) discoveredSecrets.push(input)
      return
    }
    if (Array.isArray(input)) {
      input.forEach(collectStrings)
      return
    }
    if (isRecord(input)) Object.values(input).forEach(collectStrings)
  }
  const discover = (input: unknown): void => {
    if (Array.isArray(input)) {
      input.forEach(discover)
      return
    }
    if (!isRecord(input)) return
    for (const [key, entry] of Object.entries(input)) {
      if (SENSITIVE_OUTPUT_KEY.test(key)) collectStrings(entry)
      else discover(entry)
    }
  }
  discover(value)
  const secrets = [...new Set([...secretValues, ...discoveredSecrets].filter(Boolean))]
    .sort((left, right) => right.length - left.length)
  const secretPattern = secrets.length > 0
    ? new RegExp(secrets.map(secret => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    : undefined
  const redact = (input: unknown): unknown => {
    if (typeof input === 'string') {
      return secretPattern ? input.replace(secretPattern, '[REDACTED]') : input
    }
    if (Array.isArray(input)) return input.map(redact)
    if (!isRecord(input)) return input
    return Object.fromEntries(Object.entries(input).map(([key, entry]) => [
      key,
      SENSITIVE_OUTPUT_KEY.test(key)
        ? '[REDACTED]'
        : DIAGNOSTIC_LOG_KEY.test(key)
          ? Array.isArray(entry) ? entry.map(() => '[REDACTED]') : '[REDACTED]'
          : redact(entry)
    ]))
  }
  return redact(value)
}

function canonicalSecretReferences(value: unknown): unknown {
  if (typeof value === 'string') return /^\$\{env:[A-Z_][A-Z0-9_]*\}$/.test(value) ? '${remote}' : value
  if (Array.isArray(value)) return value.map(canonicalSecretReferences)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, canonicalSecretReferences(entry)]))
}

export function externalAuthManifestsEquivalent(left: unknown, right: unknown): boolean {
  return valuesEqual(canonicalSecretReferences(left), canonicalSecretReferences(right))
}
