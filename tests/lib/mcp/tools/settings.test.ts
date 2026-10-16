import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliConfig } from '../../../../src/lib/config/environment.js'
import { createMcpServer } from '../../../../src/lib/mcp/server.js'
import { settingsToolset } from '../../../../src/lib/mcp/tools/settings.js'
import { listSecrets } from '../../../../src/lib/secrets/ledger.js'
import { completeAppVersion } from '../../../helpers/app-files.js'
import { connectClient, textOf } from '../../../helpers/mcp-client.js'
import { API, OAUTH, portalConfig, routePortal, signIn } from '../../../helpers/portal.js'

let config: CliConfig
let client: Client
const APP_ROUTES = {
  [`GET ${API}/app?skip=0&limit=100`]: {
    apps: [{ _id: 'version-1', appId: 'app-1', name: 'Acme CRM' }],
    totalCount: 1
  },
  [`GET ${API}/app/app-1/versions/latest`]: completeAppVersion(),
  [`GET ${API}/app/app-1/versions/version-1`]: completeAppVersion()
}
const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: { appId: 'app-1', ...args } })

beforeEach(async () => {
  config = await portalConfig()
  await signIn(config)
  client = await connectClient(createMcpServer({ version: '1.0.0', toolsets: [settingsToolset(config)] }))
})

afterEach(async () => {
  await client.close()
  await fs.rm(config.configDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('manage-client-keys', () => {
  it('creates a key without ever returning its secret', async () => {
    vi.stubGlobal(
      'fetch',
      routePortal({
        ...APP_ROUTES,
        [`POST ${API}/app/secrets/app-1/clientKey`]: { clientKey: { id: 'client-2', secret: 'top-secret' } }
      })
    )
    const text = textOf(await call('manage-client-keys', { action: 'create', name: 'Staging' }))
    expect(text).toBe(
      'Created client key "Staging" with client id client-2. Its secret is stored locally only; the user can view it once with `ghl secrets reveal`.'
    )
    expect(text).not.toContain('top-secret')
    expect(await listSecrets(config.configDir, 'default')).toEqual([
      expect.objectContaining({ reference: 'client-2', value: 'top-secret' })
    ])
  })

  it('makes a key the default, and asks for the arguments each action needs', async () => {
    const fetch = routePortal({ ...APP_ROUTES, [`PUT ${API}/app/secrets/app-1/clientKey/client-1/default`]: {} })
    vi.stubGlobal('fetch', fetch)
    expect(textOf(await call('manage-client-keys', { action: 'default', keyId: 'client-1' }))).toBe(
      'Client key client-1 is already the default.'
    )
    expect(textOf(await call('manage-client-keys', { action: 'delete' }))).toBe(
      'INVALID_INPUT: delete needs the keyId from get-app.'
    )
    expect(textOf(await call('manage-client-keys', { action: 'create' }))).toBe(
      'INVALID_INPUT: create needs a key name.'
    )
  })
})

describe('update-media', () => {
  it('deletes media named by file, detaching it before removing it from storage', async () => {
    let version = completeAppVersion()
    const fetch = routePortal({
      ...APP_ROUTES,
      [`GET ${API}/app/app-1/versions/version-1`]: () => version,
      [`PUT ${API}/app/profile/app-1/versions/version-1/appProfiles`]: (init: RequestInit | undefined) => {
        version = { ...version, previewImageUrls: JSON.parse(String(init?.body)).previewImageUrls }
        return { oAuthClient: { _id: 'version-1' } }
      },
      [`DELETE ${OAUTH}/clients/app-1/files`]: {}
    })
    vi.stubGlobal('fetch', fetch)

    expect(textOf(await call('update-media', { remove: ['agency-2.png'] }))).toBe(
      [
        'Removed agency-2.png.',
        'Media now: logo logo.png; 2 agency and 3 sub-account screenshot(s).',
        'An app workspace now lags behind these media fields; pull-app refreshes it.'
      ].join('\n')
    )
    const profiles = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(profiles?.[1]?.body)).previewImageUrls).toEqual([
      'https://cdn.acme.example.com/agency-1.png',
      'https://cdn.acme.example.com/agency-3.png'
    ])
    const deletion = fetch.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(JSON.parse(String(deletion?.[1]?.body))).toEqual({ fileUrls: ['https://cdn.acme.example.com/agency-2.png'] })
  })

  it('validates every upload before deleting anything', async () => {
    const fetch = routePortal(APP_ROUTES)
    vi.stubGlobal('fetch', fetch)
    const notAnImage = path.join(config.configDir, 'shot.png')
    await fs.writeFile(notAnImage, 'not an image')

    const result = await call('update-media', { remove: ['agency-2.png'], screenshots: [notAnImage] })
    expect(textOf(result)).toMatch(/^FAILED: .*is not a valid readable image/)
    expect(fetch.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('refuses unknown media and an empty request', async () => {
    vi.stubGlobal('fetch', routePortal(APP_ROUTES))
    expect(textOf(await call('update-media', { remove: ['missing.png'] }))).toBe(
      'NOT_FOUND: Not found on this app version: missing.png'
    )
    expect(textOf(await call('update-media', {}))).toBe('INVALID_INPUT: Pass logo, screenshots, or remove.')
  })
})
