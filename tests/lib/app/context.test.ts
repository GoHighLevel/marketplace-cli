import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApiClient } from '../../../src/lib/api/client.js'
import {
  findAppById,
  findAppItemById,
  listAllApps,
  resolveApp,
  resolveAppDetails,
  toSelectedApp
} from '../../../src/lib/app/context.js'
import { CliConfig } from '../../../src/lib/config/environment.js'
import { saveSelectedApp } from '../../../src/lib/config/selection-store.js'

let dir: string
let config: CliConfig

function fakeClient(apps: Array<Record<string, unknown>>, profileName = 'default'): ApiClient {
  return {
    activeProfileName: profileName,
    listApps: async () => ({ apps, totalCount: apps.length }),
    getLatestVersion: async (appId: string) => apps.find(app => (app.appId ?? app._id) === appId)
  } as unknown as ApiClient
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-ctx-'))
  config = { portalUrl: '', apiUrl: '', oauthUrl: '', workflowsUrl: '', configDir: dir }
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('toSelectedApp', () => {
  it('uses appId when present and _id as the versionId', () => {
    expect(toSelectedApp({ _id: 'v1', appId: 'a1', name: 'App' })).toEqual({
      appId: 'a1',
      versionId: 'v1',
      name: 'App'
    })
  })

  it('falls back to _id when appId is missing', () => {
    expect(toSelectedApp({ _id: 'v1', name: 'App' }).appId).toBe('v1')
  })
})

describe('findAppById', () => {
  it('matches by appId or version _id', async () => {
    const client = fakeClient([{ _id: 'v1', appId: 'a1', name: 'App' }])
    expect((await findAppById(client, 'a1')).versionId).toBe('v1')
    expect((await findAppById(client, 'v1')).appId).toBe('a1')
  })

  it('throws a helpful error for unknown ids', async () => {
    await expect(findAppById(fakeClient([]), 'nope')).rejects.toThrow(/not found/)
  })

  it('uses a stored name hint to avoid scanning unrelated app pages', async () => {
    const calls: Array<{ search?: string }> = []
    const target = { _id: 'v1', appId: 'a1', name: 'Target' }
    const client = {
      listApps: async (options: { search?: string }) => {
        calls.push(options)
        return { apps: [target], totalCount: 1 }
      }
    } as unknown as ApiClient

    await expect(findAppItemById(client, 'a1', 'Target')).resolves.toEqual(target)
    expect(calls).toEqual([{ skip: 0, limit: 100, search: 'Target' }])
  })

  it('paginates through the full developer account before reporting not found', async () => {
    const pages = [
      { apps: [{ _id: 'v1', appId: 'a1', name: 'First' }], totalCount: 2 },
      { apps: [{ _id: 'v2', appId: 'a2', name: 'Second' }], totalCount: 2 }
    ]
    const calls: number[] = []
    const client = {
      activeProfileName: 'default',
      listApps: async ({ skip = 0 }: { skip?: number }) => {
        calls.push(skip)
        return pages[skip === 0 ? 0 : 1]
      },
      getLatestVersion: async () => pages[1].apps[0]
    } as unknown as ApiClient

    await expect(findAppById(client, 'a2')).resolves.toMatchObject({ appId: 'a2', versionId: 'v2' })
    expect(calls).toEqual([0, 100])
  })
})

describe('listAllApps', () => {
  it('loads every page for interactive selection', async () => {
    const calls: number[] = []
    const client = {
      listApps: async ({ skip = 0 }: { skip?: number }) => {
        calls.push(skip)
        return skip === 0
          ? { apps: [{ _id: 'v1', name: 'First' }], totalCount: 2 }
          : { apps: [{ _id: 'v2', name: 'Second' }], totalCount: 2 }
      }
    } as unknown as ApiClient
    await expect(listAllApps(client)).resolves.toHaveLength(2)
    expect(calls).toEqual([0, 100])
  })
})

describe('resolveApp', () => {
  it('prefers the explicit flag over the stored selection', async () => {
    await saveSelectedApp(dir, 'default', { appId: 'stored', versionId: 'v0' })
    const client = fakeClient([{ _id: 'v1', appId: 'flag-app', name: 'Flagged' }])
    expect((await resolveApp(client, config, 'flag-app')).appId).toBe('flag-app')
  })

  it('returns the already-fetched summary for an explicit app', async () => {
    const client = fakeClient([{ _id: 'v1', appId: 'flag-app', name: 'Flagged' }])
    await expect(resolveAppDetails(client, config, 'flag-app')).resolves.toMatchObject({
      selected: { appId: 'flag-app', versionId: 'v1' },
      summary: { appId: 'flag-app', _id: 'v1' }
    })
  })

  it('resolves an explicit app id to its latest draft instead of the app-list version', async () => {
    const summary = { _id: 'live-version', appId: 'flag-app', name: 'Live App' }
    const client = {
      listApps: async () => ({ apps: [summary], totalCount: 1 }),
      getLatestVersion: async () => ({ _id: 'draft-version', appId: 'flag-app', name: 'Draft App', status: 'draft' })
    } as unknown as ApiClient

    await expect(resolveAppDetails(client, config, 'flag-app')).resolves.toMatchObject({
      selected: { appId: 'flag-app', versionId: 'draft-version', name: 'Draft App' },
      summary
    })
  })

  it('falls back to the stored selection', async () => {
    await saveSelectedApp(dir, 'default', { appId: 'stored', versionId: 'v0', name: 'Stored' })
    expect((await resolveApp(fakeClient([]), config)).appId).toBe('stored')
  })

  it('prefers the enclosing app workspace over the stored selection', async () => {
    await saveSelectedApp(dir, 'default', { appId: 'stored', versionId: 'stored-version', name: 'Stored' })
    const workspace = path.join(dir, 'workspace')
    const nested = path.join(workspace, 'src', 'modules')
    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'ghl-app.json'),
      JSON.stringify({
        appId: 'workspace-app',
        versionId: 'workspace-version',
        basicInfo: { name: 'Workspace App' }
      })
    )

    await expect(resolveApp(fakeClient([]), config, undefined, nested)).resolves.toEqual({
      appId: 'workspace-app',
      versionId: 'workspace-version',
      name: 'Workspace App'
    })
  })

  it('still lets an explicit app flag override the enclosing workspace', async () => {
    const workspace = path.join(dir, 'workspace')
    await fs.mkdir(workspace)
    await fs.writeFile(
      path.join(workspace, 'ghl-app.json'),
      JSON.stringify({ appId: 'workspace-app', versionId: 'workspace-version' })
    )
    const client = fakeClient([{ _id: 'flag-version', appId: 'flag-app', name: 'Flag App' }])

    await expect(resolveApp(client, config, 'flag-app', workspace)).resolves.toMatchObject({ appId: 'flag-app' })
  })

  it('errors with a hint when nothing is selected', async () => {
    await expect(resolveApp(fakeClient([]), config)).rejects.toThrow(/ghl app use/)
  })
})
