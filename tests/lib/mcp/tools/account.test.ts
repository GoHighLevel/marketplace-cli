import { promises as fs } from 'node:fs'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCredentials } from '../../../../src/lib/auth/token-store.js'
import { listSecrets } from '../../../../src/lib/secrets/ledger.js'
import type { CliConfig } from '../../../../src/lib/config/environment.js'
import { getSelectedApp, saveSelectedApp } from '../../../../src/lib/config/selection-store.js'
import { createMcpServer } from '../../../../src/lib/mcp/server.js'
import { accountToolset } from '../../../../src/lib/mcp/tools/account.js'
import { connectClient, textOf } from '../../../helpers/mcp-client.js'
import { API, approveInBrowser, portalConfig, routePortal, signIn } from '../../../helpers/portal.js'

const TEAMS = [
  { team: 'team-1', name: 'Acme', role: 'OWNER' },
  { team: 'team-2', name: 'Beta', role: 'USER' }
]
const APPS = {
  apps: [
    { _id: 'v1', appId: 'app-1', name: 'Acme Sync', version: '1.2.0', status: 'live', private: false },
    { _id: 'v2', appId: 'app-2', name: 'Acme\nInternal', version: 'draft', status: 'draft', private: true }
  ],
  totalCount: 2
}
const ACCOUNT_ROUTES = {
  [`GET ${API}/users/teams`]: TEAMS,
  [`GET ${API}/app?skip=0&limit=50`]: APPS,
  [`GET ${API}/app?skip=0&limit=10`]: APPS
}
let config: CliConfig
let client: Client
let openUrl: ReturnType<typeof vi.fn>

async function connect(approvalWaitMs = 2_000): Promise<Client> {
  return connectClient(
    createMcpServer({ version: '1.0.0', toolsets: [accountToolset(config, { openUrl, approvalWaitMs })] })
  )
}

beforeEach(async () => {
  config = await portalConfig()
  openUrl = vi.fn(async () => undefined)
  client = await connect()
})

afterEach(async () => {
  await client.close()
  await fs.rm(config.configDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('get-account', () => {
  it('shows the developer, every account, and the apps of the active one in one call', async () => {
    await signIn(config, { email: 'dev@example.com' })
    await saveSelectedApp(config.configDir, 'default', { appId: 'app-1', versionId: 'v1' })
    vi.stubGlobal('fetch', routePortal(ACCOUNT_ROUTES))

    expect(textOf(await client.callTool({ name: 'get-account', arguments: {} }))).toBe(
      [
        'Logged in as dev@example.com (profile "default").',
        'Active account: Acme (team-1), OWNER.',
        'Other accounts: Beta (team-2).',
        'Apps (2):',
        '- Acme Sync: appId app-1 (1.2.0, live, public) [selected]',
        '- Acme Internal: appId app-2 (draft, private)'
      ].join('\n')
    )
  })

  it('searches apps by name and says when more apps exist than were shown', async () => {
    await signIn(config)
    vi.stubGlobal(
      'fetch',
      routePortal({
        [`GET ${API}/users/teams`]: TEAMS,
        [`GET ${API}/app?skip=0&limit=50&nameSearch=sync`]: { apps: APPS.apps.slice(0, 1), totalCount: 60 }
      })
    )
    const text = textOf(await client.callTool({ name: 'get-account', arguments: { search: 'sync' } }))
    expect(text).toContain('Apps matching "sync" (60):')
    expect(text.endsWith('[Showing 1 of 60; pass search to narrow.]')).toBe(true)
  })

  it('returns AUTH_REQUIRED without a session', async () => {
    const result = await client.callTool({ name: 'get-account', arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^AUTH_REQUIRED: /)
  })
})

describe('switch-account', () => {
  it('switches the account for the CLI, clears the old app selection, and lists the new apps', async () => {
    await signIn(config)
    await saveSelectedApp(config.configDir, 'default', { appId: 'app-1', versionId: 'v1' })
    const fetch = routePortal(ACCOUNT_ROUTES)
    vi.stubGlobal('fetch', fetch)

    const text = textOf(await client.callTool({ name: 'switch-account', arguments: { accountId: 'team-2' } }))
    expect(text.split('\n')[0]).toBe('Switched to Beta (team-2). The app selected in the previous account was cleared.')
    expect((await loadCredentials(config.configDir)).profiles.default.teamId).toBe('team-2')
    expect(await getSelectedApp(config.configDir, 'default')).toBeUndefined()
    const appsRequest = fetch.mock.calls.find(([url]) => String(url).includes('/app?'))
    expect((appsRequest?.[1]?.headers as Record<string, string>).teamid).toBe('team-2')
  })

  it('lists only the first apps of a large account and points at get-account search', async () => {
    await signIn(config)
    vi.stubGlobal(
      'fetch',
      routePortal({ ...ACCOUNT_ROUTES, [`GET ${API}/app?skip=0&limit=10`]: { apps: APPS.apps, totalCount: 129 } })
    )
    const text = textOf(await client.callTool({ name: 'switch-account', arguments: { accountId: 'team-2' } }))
    expect(text.split('\n').at(-1)).toBe('[Showing 2 of 129; get-account with search finds the others.]')
  })

  it('reports an account that is already active, and an unknown account with the choices', async () => {
    await signIn(config)
    vi.stubGlobal('fetch', routePortal(ACCOUNT_ROUTES))

    const same = await client.callTool({ name: 'switch-account', arguments: { accountId: 'team-1' } })
    expect(textOf(same).split('\n')[0]).toBe('Acme (team-1) is already the active account.')

    const unknown = await client.callTool({ name: 'switch-account', arguments: { accountId: 'team-9' } })
    expect(textOf(unknown)).toBe(
      'NOT_FOUND: Account "team-9" is not available. Accounts: Acme (team-1); Beta (team-2).'
    )
    const invalid = await client.callTool({ name: 'switch-account', arguments: { accountId: '../x' } })
    expect(invalid.isError).toBe(true)
  })
})

describe('login', () => {
  const TOKENS = { accessToken: 'jwt', refreshToken: 'mrt', developer: { id: 'd1', email: 'dev@example.com' } }

  it('does not open a browser while the stored session works', async () => {
    await signIn(config)
    vi.stubGlobal('fetch', routePortal(ACCOUNT_ROUTES))

    const text = textOf(await client.callTool({ name: 'login', arguments: {} }))
    expect(text).toMatch(/The session works; pass force: true only to log in as another developer\.$/)
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('opens the portal and finishes once the user approves', async () => {
    vi.stubGlobal('fetch', routePortal({ [`POST ${API}/cli-auth/token`]: TOKENS }))
    openUrl.mockImplementation(async (url: string) => approveInBrowser(url))

    const text = textOf(await client.callTool({ name: 'login', arguments: {} }))
    expect(text).toBe('Logged in as dev@example.com. Portal tools now use this session.')
    expect((await loadCredentials(config.configDir)).profiles.default.accessToken).toBe('jwt')
  })

  it('returns while approval is pending and completes in the background', async () => {
    await client.close()
    client = await connect(20)
    vi.stubGlobal('fetch', routePortal({ [`POST ${API}/cli-auth/token`]: TOKENS }))

    const text = textOf(await client.callTool({ name: 'login', arguments: {} }))
    expect(text).toMatch(
      /^Opened the HighLevel login page in the browser\. Ask the user to approve it there \(https:\/\/portal\.test\/cli-auth\?/
    )

    const [url] = openUrl.mock.calls[0] as [string]
    await approveInBrowser(url)
    await vi.waitFor(async () =>
      expect((await loadCredentials(config.configDir)).profiles.default?.accessToken).toBe('jwt')
    )
  })

  it('shares one browser login between concurrent calls', async () => {
    vi.stubGlobal('fetch', routePortal({ [`POST ${API}/cli-auth/token`]: TOKENS }))
    let approve: () => void = () => undefined
    const approved = new Promise<void>(resolve => (approve = resolve))
    openUrl.mockImplementation(async (url: string) => {
      void approved.then(() => approveInBrowser(url))
    })

    const calls = [client.callTool({ name: 'login', arguments: {} }), client.callTool({ name: 'login', arguments: {} })]
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalled())
    approve()
    const texts = (await Promise.all(calls)).map(textOf)
    expect(texts).toEqual([texts[0], texts[0]])
    expect(texts[0]).toBe('Logged in as dev@example.com. Portal tools now use this session.')
    expect(openUrl).toHaveBeenCalledOnce()
  })

  it('reports a login the user denied', async () => {
    openUrl.mockImplementation(async (url: string) => {
      const authorize = new URL(url)
      await fetchCallback(`http://127.0.0.1:${authorize.searchParams.get('port')}/callback?error=access_denied`)
    })
    const result = await client.callTool({ name: 'login', arguments: { force: true } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('LOGIN_FAILED: Login was denied in the browser (access_denied)')
  })
})

async function fetchCallback(url: string): Promise<void> {
  const { get } = await import('node:http')
  await new Promise<void>((resolve, reject) => get(url, () => resolve()).on('error', reject))
}

describe('manage-sandbox', () => {
  const ACCOUNT = { _id: 'sandbox-1', name: 'Test agency', companyId: 'company-1', expiryDate: '2026-11-01T00:00:00Z' }
  const sandbox = (args: Record<string, unknown>) => client.callTool({ name: 'manage-sandbox', arguments: args })

  it('lists, creates with a ledgered password, and deletes sandbox agencies', async () => {
    await signIn(config)
    vi.stubGlobal(
      'fetch',
      routePortal({
        [`GET ${API}/sandbox`]: { accounts: [ACCOUNT], apps: { 'company-1': ['Acme CRM'] } },
        [`POST ${API}/sandbox`]: ACCOUNT,
        [`DELETE ${API}/sandbox/sandbox-1`]: {}
      })
    )

    expect(textOf(await sandbox({ action: 'list' }))).toBe(
      '- Test agency (company id company-1, expires 2026-11-01, apps: Acme CRM)'
    )
    const created = textOf(await sandbox({ action: 'create', name: 'Test agency' }))
    expect(created).toMatch(/^Created sandbox agency Test agency \(company id company-1, expires 2026-11-01\)\. /)
    const [entry] = await listSecrets(config.configDir, 'default')
    expect(created).not.toContain(entry.value)

    expect(textOf(await sandbox({ action: 'delete', sandboxId: 'company-1' }))).toBe(
      'Deleted sandbox agency Test agency and its data.'
    )
    expect(await listSecrets(config.configDir, 'default')).toEqual([])
    expect(textOf(await sandbox({ action: 'delete' }))).toBe('INVALID_INPUT: delete needs the sandboxId from list.')
  })
})
