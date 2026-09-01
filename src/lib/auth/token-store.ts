import { promises as fs } from 'node:fs'
import path from 'node:path'

import { isRecord } from '../api/response.js'
import { readJsonFile, writeJsonFileAtomic } from '../shared/json-file.js'
import { validateProfileName } from '../shared/validation.js'

export interface StoredProfile {
  accessToken: string
  refreshToken?: string
  /* Absolute Unix expiry in milliseconds; legacy epoch seconds are accepted when evaluated. */
  expiresAt?: number
  developerId?: string
  email?: string
  teamId?: string
  teamName?: string
}

export interface CredentialsFile {
  version: 1
  activeProfile: string
  profiles: Record<string, StoredProfile>
}

function credentialsPath(configDir: string): string {
  return path.join(configDir, 'credentials.json')
}

function isStoredProfile(value: unknown): value is StoredProfile {
  if (!isRecord(value) || typeof value.accessToken !== 'string' || value.accessToken.length === 0) return false
  if (value.expiresAt !== undefined && (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt))) {
    return false
  }
  return ['refreshToken', 'developerId', 'email', 'teamId', 'teamName'].every(
    field => value[field] === undefined || typeof value[field] === 'string'
  )
}

export async function loadCredentials(configDir: string): Promise<CredentialsFile> {
  const filePath = credentialsPath(configDir)
  const existing = await readJsonFile<unknown>(filePath)
  if (existing === undefined) return { version: 1, activeProfile: 'default', profiles: {} }
  const hasActiveProfile =
    isRecord(existing) &&
    isRecord(existing.profiles) &&
    (Object.keys(existing.profiles).length === 0 || Object.hasOwn(existing.profiles, String(existing.activeProfile)))
  if (
    !isRecord(existing) ||
    existing.version !== 1 ||
    typeof existing.activeProfile !== 'string' ||
    !isRecord(existing.profiles) ||
    validateProfileName(existing.activeProfile) !== true ||
    !hasActiveProfile ||
    !Object.entries(existing.profiles).every(
      ([name, profile]) => validateProfileName(name) === true && isStoredProfile(profile)
    )
  ) {
    throw new Error(`Credentials file "${filePath}" has an invalid structure.`)
  }
  return existing as unknown as CredentialsFile
}

/* Logout: remove every file holding tokens or session-scoped state. The
   secret ledger is deliberately kept — its one-time values (client secrets,
   sandbox passwords) cannot be recovered from the API after deletion. */
export async function clearStoredSession(configDir: string): Promise<string[]> {
  const removed: string[] = []
  for (const file of ['credentials.json', 'config.json']) {
    try {
      await fs.unlink(path.join(configDir, file))
      removed.push(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return removed
}

export async function saveProfile(configDir: string, name: string, profile: StoredProfile): Promise<void> {
  const nameValidation = validateProfileName(name)
  if (nameValidation !== true) throw new Error(nameValidation)
  if (!isStoredProfile(profile)) throw new Error('Stored profile data has an invalid structure.')
  const current = await loadCredentials(configDir)
  const next: CredentialsFile = {
    ...current,
    activeProfile: name,
    profiles: { ...current.profiles, [name]: profile }
  }
  await writeJsonFileAtomic(credentialsPath(configDir), next)
}
