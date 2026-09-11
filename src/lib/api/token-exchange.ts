import { isRecord, readApiResponse } from './response.js'
import { CLI_VERSION_HEADERS } from './version-header.js'
import { normalizeExpiresAt } from '../auth/session.js'
import type { StoredProfile } from '../auth/token-store.js'
import { isDeveloperTeamId } from '../shared/validation.js'

export interface TokenResponse {
  accessToken: string
  refreshToken?: string
  /* Absolute Unix expiry in milliseconds. */
  expiresAt?: number
  teamId?: string
  teamName?: string
  developer?: {
    id: string
    name?: string
    email?: string
  }
}

export function storedProfileFromTokenResponse(tokens: TokenResponse): StoredProfile {
  return {
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
    ...(tokens.developer?.id ? { developerId: tokens.developer.id } : {}),
    ...(tokens.developer?.email ? { email: tokens.developer.email } : {}),
    ...(tokens.teamId ? { teamId: tokens.teamId } : {}),
    ...(tokens.teamName ? { teamName: tokens.teamName } : {})
  }
}

export async function exchangeCodeForTokens(apiUrl: string, code: string, verifier: string): Promise<TokenResponse> {
  const endpoint = `${apiUrl}/cli-auth/token`
  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...CLI_VERSION_HEADERS, 'content-type': 'application/json', developer_version: 'ghl-cli' },
      body: JSON.stringify({ code, verifier })
    })
  } catch {
    throw new Error(`Cannot reach ${new URL(endpoint).origin} to complete login.`)
  }
  const data = await readApiResponse(res, {
    failureLabel: 'Token exchange failed',
    responseLabel: 'Token exchange'
  })
  const developer = isRecord(data) ? data.developer : undefined
  const validDeveloper =
    developer === undefined ||
    (isRecord(developer) &&
      typeof developer.id === 'string' &&
      developer.id.length > 0 &&
      ['name', 'email'].every(field => developer[field] === undefined || typeof developer[field] === 'string'))
  const validTeam =
    isRecord(data) &&
    (data.teamId === undefined
      ? data.teamName === undefined
      : isDeveloperTeamId(data.teamId) &&
        (data.teamName === undefined ||
          (typeof data.teamName === 'string' && data.teamName.trim().length > 0 && data.teamName.length <= 200)))
  if (!isRecord(data) || typeof data.accessToken !== 'string' || !data.accessToken.trim()) {
    throw new Error('Token exchange returned an invalid response without an access token.')
  }
  if (
    (data.refreshToken !== undefined && (typeof data.refreshToken !== 'string' || !data.refreshToken)) ||
    (data.expiresAt !== undefined && (typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt))) ||
    !validDeveloper ||
    !validTeam
  ) {
    throw new Error('Token exchange returned an invalid response.')
  }
  const response = {
    ...data,
    ...(typeof data.expiresAt === 'number' ? { expiresAt: normalizeExpiresAt(data.expiresAt) } : {})
  } as unknown as TokenResponse
  if (response.teamName) response.teamName = response.teamName.trim()
  return response
}
