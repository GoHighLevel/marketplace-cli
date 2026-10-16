import { promises as fs } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAuthorizeUrl, startBrowserLogin } from '../../../src/lib/auth/browser-login.js'
import { loadCredentials } from '../../../src/lib/auth/token-store.js'
import type { CliConfig } from '../../../src/lib/config/environment.js'
import { API, approveInBrowser, portalConfig, routePortal } from '../../helpers/portal.js'

let config: CliConfig

beforeEach(async () => {
  config = await portalConfig()
})

afterEach(async () => {
  await fs.rm(config.configDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('buildAuthorizeUrl', () => {
  it('builds the browser login URL on the configured developer portal', () => {
    const authorizeUrl = buildAuthorizeUrl('https://marketplace.gohighlevel.com', {
      challenge: 'pkce-challenge',
      state: 'request-state',
      port: 51_234
    })

    expect(authorizeUrl.href).toBe(
      'https://marketplace.gohighlevel.com/cli-auth?challenge=pkce-challenge&state=request-state&port=51234'
    )
  })
})

describe('startBrowserLogin', () => {
  it('waits for approval on a local callback, then stores the exchanged session', async () => {
    const fetch = routePortal({
      [`POST ${API}/cli-auth/token`]: {
        accessToken: 'jwt',
        refreshToken: 'mrt',
        developer: { id: 'd1', email: 'dev@example.com' }
      }
    })
    vi.stubGlobal('fetch', fetch)
    const login = await startBrowserLogin(config, 'work')
    expect(login.url).toMatch(/^https:\/\/portal\.test\/cli-auth\?challenge=.+&state=.+&port=\d+$/)

    await expect(approveInBrowser(login.url)).resolves.toBe(200)
    const code = await login.approval
    await expect(login.signIn(code)).resolves.toBe('dev@example.com')

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ code: 'one-time-code' })
    const credentials = await loadCredentials(config.configDir)
    expect(credentials.activeProfile).toBe('work')
    expect(credentials.profiles.work).toMatchObject({ accessToken: 'jwt', email: 'dev@example.com' })
  })
})
