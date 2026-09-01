import { CliConfig } from '../config/environment.js'
import { isRecord, readApiResponse } from '../api/response.js'
import { CLI_VERSION_HEADERS } from '../api/version-header.js'
import { loadCredentials, saveProfile, StoredProfile } from './token-store.js'

const EXPIRY_SKEW_MS = 60_000
const EPOCH_MILLISECONDS_THRESHOLD = 100_000_000_000

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in. Run `ghl login` first.')
  }
}

/* Reads the exp claim (epoch seconds) from a JWT without verifying it —
   the CLI only needs it to decide when to refresh proactively. */
export function decodeJwtExp(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : undefined
  } catch {
    return undefined
  }
}

export function normalizeExpiresAt(expiresAt: number): number {
  /* Epoch seconds are currently ten digits while epoch milliseconds are thirteen. */
  return expiresAt < EPOCH_MILLISECONDS_THRESHOLD ? expiresAt * 1000 : expiresAt
}

export function isExpired(token: string, expiresAt?: number, now = Date.now()): boolean {
  const jwtExpiry = decodeJwtExp(token)
  const expiries = [
    ...(expiresAt !== undefined ? [normalizeExpiresAt(expiresAt)] : []),
    ...(jwtExpiry !== undefined ? [jwtExpiry * 1000] : [])
  ]
  return expiries.some(expiry => expiry - EXPIRY_SKEW_MS <= now)
}

export async function loadActiveSession(config: CliConfig): Promise<{ name: string; profile: StoredProfile }> {
  const creds = await loadCredentials(config.configDir)
  const name = creds.activeProfile
  const profile = creds.profiles[name]
  if (!profile?.accessToken) throw new NotLoggedInError()
  return { name, profile }
}

/* Exchanges the stored refresh token for a fresh session on the oauth
   service and persists the rotated pair before returning it. */
export async function refreshSession(config: CliConfig, name: string, profile: StoredProfile): Promise<StoredProfile> {
  if (!profile.refreshToken) throw new NotLoggedInError()

  let res: Response
  try {
    res = await fetch(`${config.oauthUrl}/developers/login/refresh`, {
      method: 'POST',
      headers: {
        ...CLI_VERSION_HEADERS,
        'content-type': 'application/json',
        channel: 'APP',
        source: 'DEVELOPER_WEB_USER',
        version: '2021-07-28'
      },
      body: JSON.stringify({ refreshToken: profile.refreshToken })
    })
  } catch {
    throw new Error(`Cannot reach ${new URL(config.oauthUrl).origin} to refresh the session.`)
  }

  if (!res.ok) {
    throw new Error('Session expired. Run `ghl login` again.')
  }

  const data = await readApiResponse(res, { failureLabel: 'Session refresh failed', responseLabel: 'Session refresh' })
  if (
    !isRecord(data) ||
    typeof data.jwt !== 'string' ||
    !data.jwt ||
    typeof data.mrt !== 'string' ||
    !data.mrt ||
    (data.expiresAt !== undefined && (typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt)))
  ) {
    throw new Error('Session refresh returned an invalid token response. Run `ghl login` again.')
  }
  const jwtExpiry = decodeJwtExp(data.jwt)
  const refreshedExpiry = typeof data.expiresAt === 'number'
    ? normalizeExpiresAt(data.expiresAt)
    : jwtExpiry === undefined
      ? undefined
      : jwtExpiry * 1000
  const updated: StoredProfile = {
    ...profile,
    accessToken: data.jwt,
    refreshToken: data.mrt
  }
  if (refreshedExpiry === undefined) delete updated.expiresAt
  else updated.expiresAt = refreshedExpiry
  await saveProfile(config.configDir, name, updated)
  return updated
}
