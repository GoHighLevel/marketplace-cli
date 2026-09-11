import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type CliConfig } from '../../../src/lib/config/environment.js'
import {
  decodeJwtExp,
  isExpired,
  loadActiveSession,
  NotLoggedInError,
  refreshSession
} from '../../../src/lib/auth/session.js'
import { loadCredentials, saveProfile } from '../../../src/lib/auth/token-store.js'
import { packageVersion } from '../../helpers/package-version.js'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
}

let dir: string
let config: CliConfig

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-session-'))
  config = { portalUrl: '', apiUrl: '', oauthUrl: 'https://oauth.test', workflowsUrl: '', configDir: dir }
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('decodeJwtExp / isExpired', () => {
  it('reads the exp claim', () => {
    expect(decodeJwtExp(makeJwt({ exp: 1234 }))).toBe(1234)
  })

  it('returns undefined for tokens without exp and treats them as not expired', () => {
    const token = makeJwt({ sub: 'x' })
    expect(decodeJwtExp(token)).toBeUndefined()
    expect(isExpired(token)).toBe(false)
  })

  it('detects expired and valid tokens with a safety skew', () => {
    expect(isExpired(makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 }))).toBe(true)
    expect(isExpired(makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }))).toBe(false)
  })

  it('uses expiresAt and refreshes at the 60-second boundary', () => {
    const now = 2_000_000_000_000
    const longLivedJwt = makeJwt({ exp: Math.floor(now / 1000) + 3600 })

    expect(isExpired(longLivedJwt, now + 60_001, now)).toBe(false)
    expect(isExpired(longLivedJwt, now + 60_000, now)).toBe(true)
    expect(isExpired(longLivedJwt, now + 59_999, now)).toBe(true)
  })

  it('accepts expiresAt in epoch seconds and uses the earliest known expiry', () => {
    const now = 2_000_000_000_000
    const jwtNearExpiry = makeJwt({ exp: Math.floor(now / 1000) + 30 })
    const jwtWithoutExpiry = makeJwt({ sub: 'developer' })

    expect(isExpired(jwtWithoutExpiry, Math.floor((now + 30_000) / 1000), now)).toBe(true)
    expect(isExpired(jwtWithoutExpiry, Math.floor((now + 3_600_000) / 1000), now)).toBe(false)
    expect(isExpired(jwtNearExpiry, now + 3_600_000, now)).toBe(true)
  })
})

describe('loadActiveSession', () => {
  it('throws NotLoggedInError when no credentials exist', async () => {
    await expect(loadActiveSession(config)).rejects.toThrow(NotLoggedInError)
  })

  it('returns the active profile', async () => {
    await saveProfile(dir, 'default', { accessToken: 'jwt' })
    const session = await loadActiveSession(config)
    expect(session.profile.accessToken).toBe('jwt')
  })
})

describe('refreshSession', () => {
  it('persists the rotated token pair', async () => {
    const refreshedExpiry = Math.floor(Date.now() / 1000) + 3600
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jwt: makeJwt({ exp: refreshedExpiry }), mrt: 'new-mrt' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const updated = await refreshSession(config, 'default', {
      accessToken: 'old',
      refreshToken: 'old-mrt',
      expiresAt: Date.now() - 1
    })

    expect(updated.accessToken).toBe(makeJwt({ exp: refreshedExpiry }))
    expect(updated.expiresAt).toBe(refreshedExpiry * 1000)
    const stored = await loadCredentials(dir)
    expect(stored.profiles.default.refreshToken).toBe('new-mrt')
    expect(stored.profiles.default.expiresAt).toBe(refreshedExpiry * 1000)
    expect(fetchMock.mock.calls[0][1].headers['ghl-cli-verision']).toBe(packageVersion)
  })

  it('removes a stale expiresAt when the refresh response has no usable expiry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ jwt: 'opaque-token', mrt: 'new-mrt' })
      })
    )

    const updated = await refreshSession(config, 'default', {
      accessToken: 'old',
      refreshToken: 'old-mrt',
      expiresAt: Date.now() - 1
    })

    expect(updated).not.toHaveProperty('expiresAt')
    expect((await loadCredentials(dir)).profiles.default).not.toHaveProperty('expiresAt')
  })

  it('asks the user to log in again when refresh is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    await expect(refreshSession(config, 'default', { accessToken: 'old', refreshToken: 'bad' })).rejects.toThrow(
      /Run `ghl login`/
    )
  })

  it('rejects malformed refresh responses instead of persisting empty tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }))

    await expect(refreshSession(config, 'default', { accessToken: 'old', refreshToken: 'mrt' })).rejects.toThrow(
      /invalid token response/i
    )
    expect((await loadCredentials(dir)).profiles.default).toBeUndefined()
  })

  it('reports network failures with the OAuth service origin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    await expect(refreshSession(config, 'default', { accessToken: 'old', refreshToken: 'mrt' })).rejects.toThrow(
      /Cannot reach https:\/\/oauth\.test/i
    )
  })
})
