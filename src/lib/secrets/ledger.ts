import path from 'node:path'

import { isRecord } from '../api/response.js'
import { readJsonFile, writeJsonFileAtomic } from '../shared/json-file.js'
import { validateProfileName } from '../shared/validation.js'

export type SecretKind = 'client-secret' | 'sandbox-password' | 'sso-key'

export interface SecretEntry {
  kind: SecretKind
  label: string
  reference?: string
  appId?: string
  value: string
  createdAt: string
}

export interface SecretFilter {
  kind: SecretKind
  reference?: string
  appId?: string
}

interface SecretsFile {
  version: 1
  profiles: Record<string, SecretEntry[]>
}

const SECRET_KINDS = new Set<SecretKind>(['client-secret', 'sandbox-password', 'sso-key'])

function secretsPath(configDir: string): string {
  return path.join(configDir, 'secrets.json')
}

function isSecretEntry(value: unknown): value is SecretEntry {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    SECRET_KINDS.has(value.kind as SecretKind) &&
    typeof value.label === 'string' &&
    value.label.length > 0 &&
    typeof value.value === 'string' &&
    value.value.length > 0 &&
    typeof value.createdAt === 'string' &&
    value.createdAt.length > 0 &&
    (value.reference === undefined || typeof value.reference === 'string') &&
    (value.appId === undefined || typeof value.appId === 'string')
  )
}

/* App-scoped kinds resolve their app even for entries written before appId
   existed: client key ids embed the appId, sso-key references are the appId. */
export function secretAppId(entry: SecretEntry): string | undefined {
  if (entry.appId) return entry.appId
  if (entry.kind === 'client-secret') return entry.reference?.split('-')[0]
  if (entry.kind === 'sso-key') return entry.reference
  return undefined
}

export function isAppScoped(entry: SecretEntry): boolean {
  return entry.kind === 'client-secret' || entry.kind === 'sso-key'
}

function matchesSecretFilter(entry: SecretEntry, filter: SecretFilter): boolean {
  return (
    entry.kind === filter.kind &&
    (filter.reference === undefined || entry.reference === filter.reference) &&
    (filter.appId === undefined || secretAppId(entry) === filter.appId)
  )
}

async function loadSecretsFile(configDir: string): Promise<SecretsFile> {
  const existing = await readJsonFile<unknown>(secretsPath(configDir))
  if (existing === undefined) return { version: 1, profiles: {} }
  if (!isRecord(existing) || existing.version !== 1 || !isRecord(existing.profiles)) {
    throw new Error(`Secrets file "${secretsPath(configDir)}" has an unexpected format.`)
  }
  const profiles: Record<string, SecretEntry[]> = {}
  for (const [name, entries] of Object.entries(existing.profiles)) {
    if (validateProfileName(name) !== true || !Array.isArray(entries) || !entries.every(isSecretEntry)) {
      throw new Error(`Secrets file "${secretsPath(configDir)}" has an unexpected format.`)
    }
    profiles[name] = entries
  }
  return { version: 1, profiles }
}

/* One-time values (client secrets, sandbox passwords, SSO keys) are ledgered
   locally so a human can retrieve them even when an agent ran the command. */
export async function recordSecret(
  configDir: string,
  profile: string,
  entry: Omit<SecretEntry, 'createdAt'>,
  replace?: SecretFilter
): Promise<void> {
  const profileValidation = validateProfileName(profile)
  if (profileValidation !== true) throw new Error(profileValidation)
  const file = await loadSecretsFile(configDir)
  const entries = (file.profiles[profile] ?? []).filter(existing => !replace || !matchesSecretFilter(existing, replace))
  const nextEntry = { ...entry, createdAt: new Date().toISOString() }
  if (!isSecretEntry(nextEntry)) throw new Error('Secret entry has an invalid structure.')
  file.profiles = {
    ...file.profiles,
    [profile]: [...entries, nextEntry]
  }
  await writeJsonFileAtomic(secretsPath(configDir), file)
}

/* Secret capture is best-effort because the credential already exists remotely.
   Callers decide whether an explicit reveal is safe when persistence fails. */
export async function tryRecordSecret(
  configDir: string,
  profile: string,
  entry: Omit<SecretEntry, 'createdAt'>,
  replace?: SecretFilter
): Promise<boolean> {
  try {
    await recordSecret(configDir, profile, entry, replace)
    return true
  } catch {
    return false
  }
}

/* Prunes entries for credentials that stopped working (deleted client keys,
   rotated SSO keys) so the ledger only reflects live values. */
export async function removeSecrets(configDir: string, profile: string, filter: SecretFilter): Promise<number> {
  const profileValidation = validateProfileName(profile)
  if (profileValidation !== true) throw new Error(profileValidation)
  const file = await loadSecretsFile(configDir)
  const entries = file.profiles[profile] ?? []
  const remaining = entries.filter(entry => !matchesSecretFilter(entry, filter))
  if (remaining.length === entries.length) return 0
  file.profiles = { ...file.profiles, [profile]: remaining }
  await writeJsonFileAtomic(secretsPath(configDir), file)
  return entries.length - remaining.length
}

export async function listSecrets(configDir: string, profile: string): Promise<SecretEntry[]> {
  const profileValidation = validateProfileName(profile)
  if (profileValidation !== true) throw new Error(profileValidation)
  const file = await loadSecretsFile(configDir)
  return [...(file.profiles[profile] ?? [])].reverse()
}

export function maskSecret(value: string): string {
  if (value.length <= 4) return '****'
  return `****${value.slice(-4)}`
}

export function secretForOutput(value: string, _stored: boolean, reveal = false): string {
  return reveal ? value : maskSecret(value)
}

export function prepareGeneratedSecretOutput(
  value: string,
  stored: boolean,
  reveal: boolean,
  interactive: boolean
): { value: string; unavailable: boolean } {
  const mayReveal = reveal || (!stored && interactive)
  return { value: secretForOutput(value, stored, mayReveal), unavailable: !stored && !mayReveal }
}

export function canRevealGeneratedSecretInteractively(jsonEnabled: boolean): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true && !jsonEnabled
}
