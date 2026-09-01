import { afterEach, describe, expect, it, vi } from 'vitest'

import { exchangeCodeForTokens, storedProfileFromTokenResponse } from '../../../src/lib/api/token-exchange.js'
import { packageVersion } from '../../helpers/package-version.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('exchangeCodeForTokens', () => {
  it('returns a validated token response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ accessToken: 'jwt', refreshToken: 'mrt' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeCodeForTokens('https://api.test', 'code', 'verifier')).resolves.toMatchObject({
      accessToken: 'jwt'
    })
    expect(fetchMock.mock.calls[0][1].headers['ghl-cli-verision']).toBe(packageVersion)
  })

  it('validates and maps the account selected during browser authorization', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          accessToken: 'jwt',
          refreshToken: 'mrt',
          teamId: 'team-selected',
          teamName: 'Selected account',
          developer: { id: 'developer-1', email: 'dev@example.com' }
        })
      })
    )

    const tokens = await exchangeCodeForTokens('https://api.test', 'code', 'verifier')

    expect(storedProfileFromTokenResponse(tokens)).toEqual({
      accessToken: 'jwt',
      refreshToken: 'mrt',
      developerId: 'developer-1',
      email: 'dev@example.com',
      teamId: 'team-selected',
      teamName: 'Selected account'
    })
  })

  it('rejects malformed selected-account metadata before storing credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ accessToken: 'jwt', teamId: 'bad account id' })
      })
    )
    await expect(exchangeCodeForTokens('https://api.test', 'code', 'verifier')).rejects.toThrow(/invalid response/i)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ accessToken: 'jwt', teamName: 'Missing team id' })
      })
    )
    await expect(exchangeCodeForTokens('https://api.test', 'code', 'verifier')).rejects.toThrow(/invalid response/i)
  })

  it('normalizes expiresAt epoch seconds to milliseconds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ accessToken: 'jwt', refreshToken: 'mrt', expiresAt: 2_000_000_000 })
      })
    )

    await expect(exchangeCodeForTokens('https://api.test', 'code', 'verifier')).resolves.toMatchObject({
      expiresAt: 2_000_000_000_000
    })
  })

  it('rejects malformed optional token metadata before it is persisted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ accessToken: 'jwt', expiresAt: 'tomorrow' })
      })
    )
    await expect(exchangeCodeForTokens('https://api.test', 'code', 'verifier')).rejects.toThrow(/invalid response/i)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ accessToken: 'jwt', developer: { email: 'dev@example.com' } })
      })
    )
    await expect(exchangeCodeForTokens('https://api.test', 'code', 'verifier')).rejects.toThrow(/invalid response/i)
  })

  it('reports malformed success payloads and unreachable servers clearly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) })
    )
    await expect(exchangeCodeForTokens('https://api.test', 'code', 'verifier')).rejects.toThrow(/access token/i)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    await expect(exchangeCodeForTokens('https://api.test', 'code', 'verifier')).rejects.toThrow(/Cannot reach/i)
  })

  it('extracts an actionable API error without dumping the response envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => JSON.stringify({ message: ['Code is invalid', 'Verifier is invalid'], statusCode: 400 })
      })
    )

    await expect(exchangeCodeForTokens('https://api.test', 'code', 'verifier')).rejects.toThrow(
      'Token exchange failed (400): Code is invalid; Verifier is invalid'
    )
  })
})
