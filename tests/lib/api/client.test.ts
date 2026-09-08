import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClient, normalizeUploadResponse } from '../../../src/lib/api/client.js'
import { findAppItemById } from '../../../src/lib/app/context.js'
import { CliConfig } from '../../../src/lib/config/environment.js'
import { loadCredentials, saveProfile } from '../../../src/lib/auth/token-store.js'
import { packageVersion } from '../../helpers/package-version.js'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
}

function jsonResponse(body: unknown, status = 200, statusText = '') {
  return { ok: status < 400, status, statusText, json: async () => body, text: async () => JSON.stringify(body) }
}

let dir: string
let config: CliConfig
const validJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-api-'))
  config = {
    portalUrl: '',
    apiUrl: 'https://api.test/marketplace',
    oauthUrl: 'https://oauth.test',
    workflowsUrl: 'https://workflows.test/workflows-marketplace',
    configDir: dir
  }
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('ApiClient', () => {
  it('fails init when not logged in', async () => {
    const client = new ApiClient(config)
    await expect(client.init()).rejects.toThrow(/ghl login/)
  })

  it('attaches auth headers and resolves the team before listing apps', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, refreshToken: 'mrt' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ team: 'team1', name: 'My Team', role: 'OWNER' }]))
      .mockResolvedValueOnce(jsonResponse({ apps: [{ _id: '1', name: 'App' }], totalCount: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    const result = await client.listApps({})

    expect(result.totalCount).toBe(1)
    const [teamsUrl, teamsInit] = fetchMock.mock.calls[0]
    expect(String(teamsUrl)).toBe('https://api.test/marketplace/users/teams')
    expect(teamsInit.headers.authorization).toBe(`Bearer ${validJwt}`)
    expect(teamsInit.headers['ghl-cli-verision']).toBe(packageVersion)
    const [appsUrl, appsInit] = fetchMock.mock.calls[1]
    expect(String(appsUrl)).toContain('/app?skip=0&limit=50')
    expect(appsInit.headers.teamid).toBe('team1')
    expect(appsInit.headers['ghl-cli-verision']).toBe(packageVersion)

    const stored = await loadCredentials(dir)
    expect(stored.profiles.default.teamId).toBe('team1')
  })

  it('falls back to the developer owner account when login did not select a team', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, refreshToken: 'mrt' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([
        { team: 'member-team', name: 'Member account', role: 'USER' },
        { team: 'owner-team', name: 'Owner account', role: 'OWNER' }
      ]))
      .mockResolvedValueOnce(jsonResponse({ apps: [], totalCount: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await client.listApps({})

    expect(fetchMock.mock.calls[1][1].headers.teamid).toBe('owner-team')
    expect((await loadCredentials(dir)).profiles.default).toMatchObject({
      teamId: 'owner-team',
      teamName: 'Owner account'
    })
  })

  it('lists developer accounts and persists only an accessible account selection', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1', teamName: 'Primary' })
    const memberships = [
      { team: 'team1', name: 'Primary', role: 'OWNER' },
      { team: 'team2', name: 'Partner account', role: 'USER' }
    ]
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(memberships))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    const accounts = await client.listDeveloperTeams()
    const selected = await client.selectDeveloperTeam('team2', accounts)

    expect(accounts).toEqual(memberships)
    expect(selected).toEqual(memberships[1])
    expect(client.activeTeamId).toBe('team2')
    expect(client.activeTeamName).toBe('Partner account')
    expect((await loadCredentials(dir)).profiles.default).toMatchObject({
      teamId: 'team2',
      teamName: 'Partner account'
    })
  })

  it('rejects unavailable or malformed developer accounts without changing the cached team', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1', teamName: 'Primary' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ team: 'team2', name: 'Partner account', role: 'USER' }]))
      .mockResolvedValueOnce(jsonResponse([{ team: '', name: 'Invalid' }]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    const accounts = await client.listDeveloperTeams()

    await expect(client.selectDeveloperTeam('team9', accounts)).rejects.toThrow(/not available/i)
    expect((await loadCredentials(dir)).profiles.default).toMatchObject({ teamId: 'team1', teamName: 'Primary' })
    await expect(client.listDeveloperTeams()).rejects.toThrow(/unexpected response/i)
  })

  it('skips the team lookup when a teamId is already cached', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team9' })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ apps: [], totalCount: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await client.listApps({})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.teamid).toBe('team9')
  })

  it('refreshes from expiresAt before making the first API request', async () => {
    const refreshedJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    await saveProfile(dir, 'default', {
      accessToken: validJwt,
      refreshToken: 'old-mrt',
      expiresAt: Date.now() + 30_000,
      teamId: 'team9'
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jwt: refreshedJwt, mrt: 'new-mrt' }))
      .mockResolvedValueOnce(jsonResponse({ apps: [], totalCount: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await client.listApps({})

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://oauth.test/developers/login/refresh')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/app?skip=0&limit=50')
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe(`Bearer ${refreshedJwt}`)
    expect((await loadCredentials(dir)).profiles.default).toMatchObject({
      accessToken: refreshedJwt,
      refreshToken: 'new-mrt'
    })
  })

  it('rechecks expiresAt before requests made by a long-running client', async () => {
    const now = Date.now()
    const refreshedJwt = makeJwt({ exp: Math.floor(now / 1000) + 7200 })
    await saveProfile(dir, 'default', {
      accessToken: validJwt,
      refreshToken: 'old-mrt',
      expiresAt: now + 120_000,
      teamId: 'team9'
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jwt: refreshedJwt, mrt: 'new-mrt' }))
      .mockResolvedValueOnce(jsonResponse({ apps: [], totalCount: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    await client.listApps({})

    expect(String(fetchMock.mock.calls[0][0])).toContain('/developers/login/refresh')
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe(`Bearer ${refreshedJwt}`)
  })

  it('shares one proactive refresh across concurrent requests', async () => {
    const now = Date.now()
    const refreshedJwt = makeJwt({ exp: Math.floor(now / 1000) + 7200 })
    await saveProfile(dir, 'default', {
      accessToken: validJwt,
      refreshToken: 'old-mrt',
      expiresAt: now + 120_000,
      teamId: 'team9'
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jwt: refreshedJwt, mrt: 'new-mrt' }))
      .mockResolvedValueOnce(jsonResponse({ apps: [], totalCount: 0 }))
      .mockResolvedValueOnce(jsonResponse({ apps: [], totalCount: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    await Promise.all([client.listApps({}), client.listApps({})])

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/developers/login/refresh'))
    expect(refreshCalls).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('uses the oauth registry and workflow service with the exact action headers and paths', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team9' })
    const summary = {
      _id: 'summary-1',
      actionId: 'template-1',
      name: 'Send message',
      version: '1.0',
      status: 'draft'
    }
    const action = {
      templateId: 'template-1',
      appId: 'app1',
      key: 'send_message',
      version: '1.0',
      status: 'draft',
      info: { name: 'Send message' }
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ actions: [summary] }))
      .mockResolvedValueOnce(jsonResponse({ actions: [action] }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await expect(client.listWorkflowActionSummaries('app1')).resolves.toEqual([summary])
    await expect(client.listWorkflowActionConfigs('app1')).resolves.toEqual([action])

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://oauth.test/clients/app1/actions')
    expect(fetchMock.mock.calls[0][1].headers.teamid).toBe('team9')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://workflows.test/workflows-marketplace/actions')
    expect(fetchMock.mock.calls[1][1].headers.appid).toBe('app1')
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe(`Bearer ${validJwt}`)
  })

  it('uses the portal action lifecycle endpoints for every workflow-action mutation', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team9' })
    const summary = {
      _id: 'summary-1',
      actionId: 'template-1',
      name: 'Send message',
      version: '1.0',
      status: 'draft'
    }
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ availability: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true, action: summary }))
      .mockResolvedValueOnce(jsonResponse({ success: true, action: { ...summary, version: '1.1' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true, action: summary }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ hasError: false, output: { ok: true }, consoleLogs: [] }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await client.checkWorkflowActionKeyAvailability('app1', 'send_message')
    await client.createWorkflowAction('app1', { name: 'Send message', key: 'send_message', version: '1.0' })
    await client.createWorkflowActionVersion('app1', 'template-1')
    await client.updateWorkflowActionConfig('app1', 'template-1', { info: { name: 'Send message' } })
    await client.updateWorkflowActionSummary('app1', 'template-1', { name: 'Send message' })
    await client.submitWorkflowActionForReview('app1', {
      id: 'template-1',
      type: 'Action',
      version: '1.0',
      releaseNotes: { user: 'Initial release', reviewer: 'Initial release' }
    })
    await client.publishWorkflowActionSummary('app1', 'template-1', '1.0')
    await expect(client.testWorkflowAction('app1', {
      appId: 'app1',
      inputData: { email: 'developer@example.com' },
      executionConfig: { type: 'CODE', code: 'return {}', headers: [] }
    })).resolves.toEqual({ hasError: false, output: { ok: true }, consoleLogs: [] })
    await client.deleteWorkflowAction('app1', 'template-1')

    const requests = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: init.method,
      appId: init.headers.appid
    }))
    expect(requests).toEqual([
      { url: 'https://workflows.test/workflows-marketplace/slugs/availability/send_message', method: 'GET', appId: 'app1' },
      { url: 'https://oauth.test/clients/app1/actions', method: 'POST', appId: undefined },
      { url: 'https://oauth.test/clients/app1/actions/template-1/new-version', method: 'POST', appId: undefined },
      { url: 'https://workflows.test/workflows-marketplace/actions/template-1', method: 'PUT', appId: 'app1' },
      { url: 'https://oauth.test/clients/app1/actions/template-1/update', method: 'POST', appId: undefined },
      { url: 'https://workflows.test/workflows-marketplace/releases/submit-for-review', method: 'POST', appId: 'app1' },
      { url: 'https://oauth.test/clients/app1/actions/template-1/publish', method: 'POST', appId: undefined },
      { url: 'https://workflows.test/workflows-marketplace/run-code-test', method: 'POST', appId: 'app1' },
      { url: 'https://oauth.test/clients/app1/actions/template-1', method: 'DELETE', appId: undefined }
    ])
  })

  it('recovers action and trigger version creation when the registry response is stale', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team9' })
    const actionDraft = {
      templateId: 'action-template',
      appId: 'app1',
      key: 'send_message',
      version: '1.1',
      status: 'draft',
      info: { name: 'Send message' }
    }
    const triggerDraft = {
      templateId: 'trigger-template',
      appId: 'app1',
      key: 'contact_changed',
      version: '1.1',
      status: 'draft',
      info: { name: 'Contact changed' }
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, action: [] }))
      .mockResolvedValueOnce(jsonResponse({ actions: [actionDraft] }))
      .mockResolvedValueOnce(jsonResponse({ success: false, trigger: [] }))
      .mockResolvedValueOnce(jsonResponse({ triggers: [triggerDraft] }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()

    await expect(client.createWorkflowActionVersion('app1', 'action-template')).resolves.toMatchObject({
      actionId: 'action-template',
      name: 'Send message',
      version: '1.1',
      status: 'draft'
    })
    await expect(client.createWorkflowTriggerVersion('app1', 'trigger-template')).resolves.toMatchObject({
      triggerId: 'trigger-template',
      name: 'Contact changed',
      version: '1.1',
      status: 'draft'
    })
  })

  it('rejects malformed workflow action test responses at the API boundary', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team9' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ output: {} })))

    const client = new ApiClient(config)
    await client.init()

    await expect(client.testWorkflowAction('app1', {
      appId: 'app1',
      inputData: {},
      executionConfig: { type: 'CODE', code: 'return {}', headers: [] }
    })).rejects.toThrow(/workflow action test API returned an unexpected response/i)
  })

  it('uses the registry and workflow-service endpoints for the complete trigger lifecycle', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team9' })
    const summary = {
      _id: 'summary-1',
      triggerId: 'template-1',
      name: 'Contact changed',
      version: '1.0',
      status: 'draft'
    }
    const configResponse = {
      templateId: 'template-1',
      appId: 'app1',
      key: 'contact_changed',
      version: '1.0',
      status: 'draft',
      info: { name: 'Contact changed' }
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ triggers: [summary] }))
      .mockResolvedValueOnce(jsonResponse({ triggers: [configResponse] }))
      .mockResolvedValueOnce(jsonResponse({ triggers: [configResponse] }))
      .mockResolvedValueOnce(jsonResponse({ availability: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true, trigger: summary }))
      .mockResolvedValueOnce(jsonResponse({ success: true, trigger: { ...summary, version: '1.1' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true, trigger: summary }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await client.listWorkflowTriggerSummaries('app1')
    await client.listWorkflowTriggerConfigs('app1')
    await client.getWorkflowTriggerConfigs('app1', 'template-1', '1.0')
    await client.checkWorkflowTriggerKeyAvailability('app1', 'contact_changed')
    await client.createWorkflowTrigger('app1', { name: 'Contact changed', key: 'contact_changed', version: '1.0' })
    await client.createWorkflowTriggerVersion('app1', 'template-1')
    await client.updateWorkflowTriggerConfig('app1', 'template-1', { info: { name: 'Contact changed' } })
    await client.updateWorkflowTriggerSummary('app1', 'template-1', { name: 'Contact changed' })
    await client.submitWorkflowTriggerForReview('app1', {
      id: 'template-1',
      type: 'Trigger',
      version: '1.0',
      releaseNotes: { user: 'Initial release', reviewer: 'Initial release' }
    })
    await client.publishWorkflowTriggerSummary('app1', 'template-1', '1.0')
    await client.deleteWorkflowTrigger('app1', 'template-1')

    expect(fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: init.method,
      appId: init.headers.appid
    }))).toEqual([
      { url: 'https://oauth.test/clients/app1/triggers', method: 'GET', appId: undefined },
      { url: 'https://workflows.test/workflows-marketplace/triggers', method: 'GET', appId: 'app1' },
      { url: 'https://workflows.test/workflows-marketplace/triggers/template-1?version=1.0', method: 'GET', appId: 'app1' },
      { url: 'https://workflows.test/workflows-marketplace/slugs/availability/contact_changed', method: 'GET', appId: 'app1' },
      { url: 'https://oauth.test/clients/app1/triggers', method: 'POST', appId: undefined },
      { url: 'https://oauth.test/clients/app1/triggers/template-1/new-version', method: 'POST', appId: undefined },
      { url: 'https://workflows.test/workflows-marketplace/triggers/template-1', method: 'PUT', appId: 'app1' },
      { url: 'https://oauth.test/clients/app1/triggers/template-1/update', method: 'POST', appId: undefined },
      { url: 'https://workflows.test/workflows-marketplace/releases/submit-for-review', method: 'POST', appId: 'app1' },
      { url: 'https://oauth.test/clients/app1/triggers/template-1/publish', method: 'POST', appId: undefined },
      { url: 'https://oauth.test/clients/app1/triggers/template-1', method: 'DELETE', appId: undefined }
    ])
  })

  it('refreshes once on 401 and retries the request', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, refreshToken: 'mrt', teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt({ exp: 9999999999 }), mrt: 'new-mrt' }))
      .mockResolvedValueOnce(jsonResponse({ apps: [], totalCount: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    const result = await client.listApps({})

    expect(result.totalCount).toBe(0)
    expect(String(fetchMock.mock.calls[1][0])).toContain('/developers/login/refresh')
  })

  it('asks the user to log in when the retried request is still unauthorized', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, refreshToken: 'mrt', teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt({ exp: 9999999999 }), mrt: 'new-mrt' }))
      .mockResolvedValueOnce(jsonResponse({}, 401))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await expect(client.listApps({})).rejects.toThrow(/Run `ghl login` again/)
  })

  it('extracts API validation messages and accepts empty successful responses', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: ['Name is required', 'Amount must be positive'] }, 400))
      .mockResolvedValueOnce({ ok: true, status: 204, statusText: 'No Content', text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await expect(client.listApps({})).rejects.toThrow(
      'API request failed (400): Name is required; Amount must be positive'
    )
    await expect(client.deleteClientKey('app1', 'key1')).resolves.toBeUndefined()
  })

  it('reports malformed JSON success payloads explicitly', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => 'not-json' })
    )

    const client = new ApiClient(config)
    await client.init()
    await expect(client.listApps({})).rejects.toThrow(/invalid JSON/i)
  })

  it('fails clearly when the developer has no team instead of sending an unscoped request', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse([])))

    const client = new ApiClient(config)
    await client.init()
    await expect(client.listApps({})).rejects.toThrow(/No developer account/i)
  })

  it('rejects unexpected list payloads before commands dereference them', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ apps: 'not-an-array', totalCount: 1 })))
    const client = new ApiClient(config)
    await client.init()
    await expect(client.listApps({})).rejects.toThrow(/app list.*unexpected response/i)
  })

  it('rejects empty identifiers and names in app mutation responses', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ apps: [{ _id: '', name: 'App' }], totalCount: 1 }))
        .mockResolvedValueOnce(jsonResponse({ _id: 'v1', name: '' }))
    )
    const client = new ApiClient(config)
    await client.init()
    await expect(client.listApps({})).rejects.toThrow(/app list.*unexpected response/i)
    await expect(
      client.createApp({
        name: 'App',
        private: false,
        userTypes: ['Location'],
        isWhiteLabelFriendly: true,
        isAgencyBulkInstallEnabled: true
      })
    ).rejects.toThrow(/create app.*unexpected response/i)
  })

  it('finds an app summary across paginated app-list responses', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      _id: `v${index}`,
      appId: `app${index}`,
      name: `App ${index}`
    }))
    const target = { _id: 'v50', appId: 'target', name: 'Target', agencyInstallCount: 4 }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ apps: firstPage, totalCount: 51 }))
        .mockResolvedValueOnce(jsonResponse({ apps: [target], totalCount: 51 }))
    )

    const client = new ApiClient(config)
    await client.init()
    await expect(findAppItemById(client, 'target')).resolves.toEqual(target)
  })

  it('unwraps the nested clientKey on creation and rejects responses without a secret', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, refreshToken: 'mrt', teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ clientKey: { id: 'app-abc', name: 'k', secret: 's3cret' } }))
      .mockResolvedValueOnce(jsonResponse({ clientKey: { name: 'k' } }))
      .mockResolvedValueOnce(jsonResponse(null))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()

    const created = await client.addClientKey('app1', 'k')
    expect(created).toMatchObject({ id: 'app-abc', secret: 's3cret' })

    await expect(client.addClientKey('app1', 'k')).rejects.toThrow(/id\/secret/)
    await expect(client.addClientKey('app1', 'k')).rejects.toThrow(/id\/secret/)
  })

  it('lists and creates sandbox accounts, rejecting malformed responses', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, refreshToken: 'mrt', teamId: 'team1' })
    const account = { _id: 's1', name: 'Test Agency', companyId: 'c1', status: 'active' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accounts: [account], apps: { c1: ['My App'] } }))
      .mockResolvedValueOnce(jsonResponse(account))
      .mockResolvedValueOnce(jsonResponse({ accounts: 'nope' }))
      .mockResolvedValueOnce(jsonResponse({ accounts: [account], apps: { c1: 'My App' } }))
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()

    const list = await client.listSandboxAccounts()
    expect(list.accounts).toEqual([account])
    expect(list.apps.c1).toEqual(['My App'])
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.test/marketplace/sandbox')

    const created = await client.createSandboxAccount('Test Agency', 'MySandbox@Pass1')
    expect(created).toMatchObject({ companyId: 'c1' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      companyName: 'Test Agency',
      password: 'MySandbox@Pass1'
    })

    await expect(client.listSandboxAccounts()).rejects.toThrow(/unexpected response/i)
    await expect(client.listSandboxAccounts()).rejects.toThrow(/unexpected response/i)
    await expect(client.createSandboxAccount('Test Agency', 'MySandbox@Pass1')).rejects.toThrow(/unexpected response/i)
  })

  it('identifies the relevant service override when a request cannot connect', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))

    const client = new ApiClient(config)
    await client.init()

    await expect(client.getScopesCatalog()).rejects.toThrow(/GHL_OAUTH_URL/)
  })

  it('validates webhook catalogs before commands consume their mapping', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ events: ['ContactCreate'], mapping: { 'contacts.readonly': ['ContactCreate'] } }))
      .mockResolvedValueOnce(jsonResponse({ events: ['ContactCreate'], mapping: { 'contacts.readonly': 'ContactCreate' } }))
      .mockResolvedValueOnce(jsonResponse({ events: ['ContactCreate'], mapping: { 'contacts.readonly': ['Unknown'] } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()

    await expect(client.getWebhooksCatalog()).resolves.toMatchObject({ events: ['ContactCreate'] })
    await expect(client.getWebhooksCatalog()).rejects.toThrow(/webhook catalog.*unexpected response/i)
    await expect(client.getWebhooksCatalog()).rejects.toThrow(/webhook catalog.*unexpected response/i)
  })

  it('validates version-changing mutation responses before commands update their selection', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ oAuthClient: { _id: 'v2', appId: 'app1' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ oAuthClient: { _id: '' } }))
      .mockResolvedValueOnce(jsonResponse({ _id: '' }))
      .mockResolvedValueOnce(jsonResponse({ _id: 'v3' }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await expect(client.updateProfileSection('basicInfo', 'app1', 'v1', {})).resolves.toMatchObject({
      oAuthClient: { _id: 'v2' }
    })
    await expect(client.updateAuthSettings('app1', 'v1', {})).rejects.toThrow(/auth settings.*unexpected/i)
    await expect(client.cloneAsDraft('app1', 'v1')).rejects.toThrow(/draft creation.*unexpected/i)
    await expect(client.updateReviewDetails('app1', 'v1', {})).rejects.toThrow(/review details.*unexpected/i)
    await expect(client.cloneAsDraft('app1', 'v1')).rejects.toThrow(/draft creation.*unexpected/i)
    await expect(client.cloneAsDraft('app1', 'v1')).resolves.toEqual({ id: 'v3' })
  })

  it('rejects malformed validation and versioning payloads at the API boundary', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, mandatoryFields: { logo: 'no' } }))
      .mockResolvedValueOnce(jsonResponse([{ _id: 'v1', status: 1 }]))
      .mockResolvedValueOnce(jsonResponse({ updateType: 1 }))
      .mockResolvedValueOnce(jsonResponse({ _id: 'v1', allowedScopes: 'contacts.readonly' }))
      .mockResolvedValueOnce(jsonResponse([{ _id: 'p1', price: 'free' }]))
      .mockResolvedValueOnce(jsonResponse([{ _id: 'p2', features: [42] }]))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()

    await expect(client.preSubmitValidation('app1', 'v1')).rejects.toThrow(/pre-submit validation.*unexpected/i)
    await expect(client.listVersions('app1')).rejects.toThrow(/app versions.*unexpected/i)
    await expect(client.analyzeVersion('app1', 'v1')).rejects.toThrow(/version analysis.*unexpected/i)
    await expect(client.getVersion('app1', 'v1')).rejects.toThrow(/app version.*unexpected/i)
    await expect(client.getBillingPlans('app1')).rejects.toThrow(/billing plans.*unexpected/i)
    await expect(client.getBillingPlans('app1')).rejects.toThrow(/billing plans.*unexpected/i)
  })

  it('uses the exact subscription and usage billing lifecycle endpoints', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        _id: 'plan-1',
        name: 'Pro',
        features: [],
        price: 10,
        paymentTime: 'month',
        paymentType: 'recurring'
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        _id: 'meter-1',
        appId: 'app1',
        productType: 'workflow_action',
        productId: 'send_message',
        productName: 'Send message',
        customPriceType: 'fixed',
        usageUnit: 'execution',
        billingTier: [{
          _id: 'tier-1',
          name: 'Executions',
          minVolume: 0,
          maxVolume: null,
          pricePerUnit: 0.01,
          executionLimitPerCycle: 1000
        }]
      }]))
      .mockResolvedValue(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await client.getBillingPlans('app1')
    await client.getBillingUsageMeters('app1')
    await client.addBillingPlan('app1', { name: 'Pro' })
    await client.updateBillingPlan('app1', 'plan-1', { name: 'Business' })
    await client.deleteBillingPlan('app1', 'plan-1')
    await client.addBillingUsageMeter('app1', { productId: 'send_message' })
    await client.updateBillingUsageTier('app1', 'meter-1', 'tier-1', { name: 'Executions' })
    await client.deleteBillingUsageTier('app1', 'meter-1', 'tier-1')
    await client.deleteBillingUsageMeter('app1', 'meter-1')

    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init.method])).toEqual([
      ['https://api.test/marketplace/billing/clients/app1/plans', 'GET'],
      ['https://api.test/marketplace/billing/usage/app1/meter', 'GET'],
      ['https://api.test/marketplace/billing/clients/app1/plans', 'POST'],
      ['https://api.test/marketplace/billing/clients/app1/plans/plan-1', 'PUT'],
      ['https://api.test/marketplace/billing/clients/app1/plans/plan-1', 'DELETE'],
      ['https://api.test/marketplace/billing/usage/app1/meter', 'POST'],
      ['https://api.test/marketplace/billing/usage/app1/meter/meter-1/tier/tier-1', 'PATCH'],
      ['https://api.test/marketplace/billing/usage/app1/meter/meter-1/tier/tier-1', 'DELETE'],
      ['https://api.test/marketplace/billing/usage/app1/meter/meter-1', 'DELETE']
    ])
  })

  it('accepts the nullable live-version fields returned for a first publish', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          changedFields: [],
          latestLiveVersion: null,
          currentVersion: { version: 'draft', _id: 'v1' },
          suggestedVersion: '1.0.0'
        })
      )
    )

    const client = new ApiClient(config)
    await client.init()

    await expect(client.analyzeVersion('app1', 'v1')).resolves.toMatchObject({
      latestLiveVersion: null,
      suggestedVersion: '1.0.0'
    })
  })

  it('normalizes nullable optional fields returned by older live app versions', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          _id: 'legacy-live',
          appId: 'app1',
          status: 'live',
          externalBillingUrl: null,
          paymentType: null,
          additionalInfoForBilling: null,
          webhookUrl: null,
          freeTrialDuration: null,
          oneTimePrice: null,
          externalAuthConfig: null
        })
      )
    )

    const client = new ApiClient(config)
    await client.init()
    const version = await client.getVersion('app1', 'legacy-live')

    expect(version).toEqual({ _id: 'legacy-live', appId: 'app1', status: 'live' })
  })

  it('normalizes the legacy paid-app fields used by marketplace versions', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ _id: 'paid', isPaidApp: true, isFreemium: false }))
      .mockResolvedValueOnce(jsonResponse({ _id: 'freemium', isPaidApp: true, isFreemium: true }))
      .mockResolvedValueOnce(jsonResponse({ _id: 'free', isPaidApp: false, isFreemium: false }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()

    await expect(client.getVersion('app1', 'paid')).resolves.toMatchObject({ billingType: 'paid' })
    await expect(client.getVersion('app1', 'freemium')).resolves.toMatchObject({ billingType: 'freemium' })
    await expect(client.getVersion('app1', 'free')).resolves.toMatchObject({ billingType: 'free' })
  })

  it('normalizes nested auth fields and resolves the latest live version', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          _id: 'draft1',
          clientKeys: [{ id: 'top', name: 'Top' }],
          defaults: { clientKey: 'top' },
          redirectUris: ['https://draft.example.com/callback'],
          oAuthClient: [
            {
              clientKeys: [{ id: 'live', name: 'Live' }, { id: 'top', name: 'Duplicate' }],
              defaults: { clientKey: 'live' },
              redirectUris: ['https://live.example.com/callback']
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ _id: 'live1', status: 'live', private: true }))
      .mockResolvedValueOnce(jsonResponse({ _id: 'draft2', oAuthClient: 'invalid' }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    const draft = await client.getVersion('app1', 'draft1')
    expect(draft.clientKeys?.map(key => key.id)).toEqual(['top', 'live'])
    expect(draft.defaults).toEqual({ clientKey: 'live' })
    expect(draft.redirectUris).toEqual(['https://live.example.com/callback'])

    await expect(client.getLatestVersion('app1', true)).resolves.toMatchObject({ _id: 'live1', status: 'live' })
    expect(String(fetchMock.mock.calls[1][0])).toContain('/app/app1/versions/latest?isLive=true')
    await expect(client.getVersion('app1', 'draft2')).rejects.toThrow(/app version.*unexpected response/i)
  })

  it('accepts the editable OAuthClient fields used by local app files', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const response = {
      _id: 'draft1',
      appId: 'app1',
      contact: { name: 'Support', email: 'support@example.com' },
      category: 'CRM',
      hasExternalAuth: true,
      externalConfig: { name: 'Auth', verificationUrl: 'https://example.com/verify' },
      externalAuthConfig: { type: 'oauth2', fields: [] },
      mcpConfig: { mcpUrl: 'https://example.com/mcp', publicMCP: true },
      customPages: [{ title: 'Dashboard', icon: { name: 'chart' } }],
      hasUsageBasedPrice: true,
      paymentType: 'recurring',
      oneTimePrice: 99,
      additionalInfoForBilling: 'Priority support',
      subscribedEvents: [{ name: 'ContactCreate', warningFlag: false }]
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(response))
        .mockResolvedValueOnce(
          jsonResponse([{
            _id: 'plan1',
            name: 'Growth',
            features: ['Priority support'],
            price: 49,
            paymentTime: 'month',
            paymentType: 'recurring'
          }])
        )
    )

    const client = new ApiClient(config)
    await client.init()

    await expect(client.getVersion('app1', 'draft1')).resolves.toMatchObject(response)
    await expect(client.getBillingPlans('app1')).resolves.toEqual([
      {
        _id: 'plan1',
        name: 'Growth',
        features: ['Priority support'],
        price: 49,
        paymentTime: 'month',
        paymentType: 'recurring'
      }
    ])
  })

  it('rejects malformed editable OAuthClient structures at the API boundary', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ _id: 'bad-contact', contact: { email: 42 } }))
      .mockResolvedValueOnce(jsonResponse({ _id: 'bad-pages', customPages: ['page'] }))
      .mockResolvedValueOnce(
        jsonResponse({ _id: 'bad-webhook-warning', subscribedEvents: [{ name: 'ContactCreate', warningFlag: 'yes' }] })
      )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()

    await expect(client.getVersion('app1', 'bad-contact')).rejects.toThrow(/unexpected response/i)
    await expect(client.getVersion('app1', 'bad-pages')).rejects.toThrow(/unexpected response/i)
    await expect(client.getVersion('app1', 'bad-webhook-warning')).rejects.toThrow(/unexpected response/i)
  })

  it('deletes a sandbox account by its record id', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, refreshToken: 'mrt', teamId: 'team1' })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ deleted: true }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()

    await client.deleteSandboxAccount('s1')
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.test/marketplace/sandbox/s1')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('uses OAuth service routes for the external-auth lifecycle', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const configResponse = { hasExternalAuth: false, externalAuthConfig: { type: 'basic' } }
    const testUrlResponse = {
      url: 'https://provider.example.com/authorize',
      state: Buffer.from(JSON.stringify({ uuid: 'e1f345b9-4a73-44c0-9063-616d02e5f8d1' })).toString('base64url')
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(configResponse))
      .mockResolvedValueOnce(jsonResponse({ saved: true }))
      .mockResolvedValueOnce(jsonResponse({ response: { responseData: { ok: true } } }))
      .mockResolvedValueOnce(jsonResponse(testUrlResponse))
      .mockResolvedValueOnce(jsonResponse({ status: 'completed', result: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await expect(client.getExternalAuthConfig('app1', 'version1')).resolves.toEqual(configResponse)
    await client.updateExternalAuthConfig('app1', 'version1', { hasExternalAuth: false })
    await client.testExternalBasicAuth('app1', 'version1', { api_key: 'secret' })
    await expect(client.getExternalAuthTestUrl('app1', 'version1', { region: 'us' })).resolves.toEqual(testUrlResponse)
    await expect(client.getExternalAuthTestResult('app1', 'e1f345b9-4a73-44c0-9063-616d02e5f8d1')).resolves.toEqual({
      status: 'completed',
      result: { ok: true }
    })

    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      'https://oauth.test/clients/app1/authentication/config/version1',
      'https://oauth.test/clients/app1/authentication/version1',
      'https://oauth.test/clients/app1/authentication/version1/test',
      'https://oauth.test/clients/app1/authentication/version1/oauth2/test/url?userData=%7B%22region%22%3A%22us%22%7D',
      'https://oauth.test/clients/app1/authentication/oauth2/test/result/e1f345b9-4a73-44c0-9063-616d02e5f8d1'
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ hasExternalAuth: false })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ userData: { api_key: 'secret' } })
  })

  it('sends deprecation notes using the backend DTO field name', async () => {
    await saveProfile(dir, 'default', { accessToken: validJwt, teamId: 'team1' })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(config)
    await client.init()
    await client.scheduleDeprecation('app1', 'version1', {
      deprecateDate: '2026-08-20',
      timezone: 'Asia/Kolkata',
      deprecationNotes: 'Superseded by v2'
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ deprecationNotes: 'Superseded by v2' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('reason')
  })
})

describe('normalizeUploadResponse', () => {
  it('normalizes supported payloads and rejects malformed success responses', () => {
    expect(normalizeUploadResponse([{ fileName: 'a.png', fileUrl: 'https://cdn/a.png' }])).toEqual({
      'a.png': 'https://cdn/a.png'
    })
    expect(normalizeUploadResponse({ files: { 'a.png': 'https://cdn/a.png' } })).toEqual({
      'a.png': 'https://cdn/a.png'
    })
    expect(() => normalizeUploadResponse({ success: true })).toThrow(/upload.*unexpected response/i)
    expect(() => normalizeUploadResponse([{ fileName: '', fileUrl: 'https://cdn/a.png' }])).toThrow(
      /upload.*unexpected response/i
    )
    expect(() => normalizeUploadResponse({ files: { 'a.png': 'javascript:alert(1)' } })).toThrow(
      /upload.*unexpected response/i
    )
    expect(() =>
      normalizeUploadResponse([
        { fileName: 'a.png', fileUrl: 'https://cdn/a.png' },
        { fileName: 'a.png', fileUrl: 'https://cdn/duplicate.png' }
      ])
    ).toThrow(/duplicate file name/i)
  })
})
