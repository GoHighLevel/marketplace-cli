import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ApiClient } from '../../../src/lib/api/client.js'
import { checkWorkspace, errorItems } from '../../../src/lib/app/workspace-check.js'
import { completeAppVersion } from '../../helpers/app-files.js'
import { appManifest, editJson, writeTestWorkspace } from '../../helpers/workspace.js'

const BINDING = { appId: 'app-1', versionId: 'version-1' }
let directory: string

function portal(remote = completeAppVersion()): ApiClient {
  return { ensureTeam: vi.fn(async () => undefined), getVersion: vi.fn(async () => remote) } as unknown as ApiClient
}

async function onlyApp(): Promise<void> {
  await fs.rm(path.join(directory, 'src', 'modules'), { recursive: true, force: true })
  await fs.rm(path.join(directory, 'src', 'billing'), { recursive: true, force: true })
  for (const state of ['workflow-actions-state.json', 'workflow-triggers-state.json', 'billing-state.json']) {
    await fs.rm(path.join(directory, '.ghl', state), { force: true })
  }
}

beforeEach(async () => {
  directory = await writeTestWorkspace(await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-check-')))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('checkWorkspace offline', () => {
  it('validates every module of a fresh workspace, workflow modules first', async () => {
    const check = await checkWorkspace({ directory, ...BINDING })
    expect(check).toMatchObject({ directory, ...BINDING, compared: false })
    expect(check.modules.map(module => [module.name, module.items, module.errors, module.localChanges])).toEqual([
      ['actions', 0, [], []],
      ['triggers', 0, [], []],
      ['billing', 0, [], []],
      ['app', undefined, [], []]
    ])
  })

  it('reports local edits, and errors per module without stopping at the first broken module', async () => {
    await editJson(appManifest(directory), app => {
      app.basicInfo.tagline = 'A sharper tagline for every customer'
    })
    const actions = path.join(directory, 'src', 'modules', 'workflows', 'actions')
    await fs.mkdir(actions, { recursive: true })
    await fs.writeFile(path.join(actions, 'broken.json'), '{"key": 1}')

    const check = await checkWorkspace({ directory, ...BINDING })
    const byName = Object.fromEntries(check.modules.map(module => [module.name, module]))
    expect(byName.app.localChanges).toEqual(['basicInfo.tagline'])
    expect(byName.actions.errors.length).toBeGreaterThan(0)
    expect(byName.actions.unreadable).toBe(true)
    expect(byName.app.unreadable).toBeUndefined()
    expect(byName.billing.errors).toEqual([expect.stringMatching(/^Not validated: billing reads the workflow/)])
    expect(byName.triggers.errors).toEqual([])
  })

  it('lists the app edits an error belongs to', async () => {
    await editJson(appManifest(directory), app => {
      app.basicInfo.tagline = 'Short'
      app.basicInfo.website = 'https://new.example.com'
    })

    const app = (await checkWorkspace({ directory, ...BINDING })).modules.find(module => module.name === 'app')
    expect(app?.errors).toEqual([expect.stringMatching(/tagline/i)])
    expect(app?.localChanges).toEqual(['basicInfo.tagline', 'basicInfo.website'])
  })

  it('omits modules the workspace does not have', async () => {
    await onlyApp()
    expect((await checkWorkspace({ directory, ...BINDING })).modules.map(module => module.name)).toEqual(['app'])
  })
})

describe('checkWorkspace with the portal', () => {
  beforeEach(onlyApp)

  it('separates local changes, portal changes, and conflicts', async () => {
    await editJson(appManifest(directory), app => {
      app.basicInfo.tagline = 'A local tagline for every customer'
      app.basicInfo.companyName = 'Local company'
    })
    const client = portal(completeAppVersion({ companyName: 'Portal company', website: 'https://portal.example.com' }))

    const [app] = (await checkWorkspace({ directory, ...BINDING }, client)).modules
    expect(app).toMatchObject({
      localChanges: ['basicInfo.tagline'],
      portalChanges: ['basicInfo.website'],
      conflicts: ['basicInfo.companyName'],
      errors: []
    })
    expect(client.ensureTeam).toHaveBeenCalledOnce()
  })

  it('validates locally, and says why, when the developer account cannot be resolved', async () => {
    const client = portal()
    vi.mocked(client.ensureTeam).mockRejectedValue(new Error('No developer account is available.'))

    const check = await checkWorkspace({ directory, ...BINDING }, client)
    expect(check).toMatchObject({ compared: false, remoteError: 'No developer account is available.' })
    expect(check.modules[0]).toMatchObject({ name: 'app', errors: [] })
    expect(client.getVersion).not.toHaveBeenCalled()
  })

  it('issues a plan id only for a pushable plan, and a new one when the files change', async () => {
    const client = portal()
    expect((await checkWorkspace({ directory, ...BINDING }, client)).planId).toBeUndefined()

    await editJson(appManifest(directory), app => {
      app.basicInfo.tagline = 'A local tagline for every customer'
    })
    const first = await checkWorkspace({ directory, ...BINDING }, client)
    expect(first.planId).toMatch(/^[0-9a-f]{12}$/)
    expect(first.modules[0].operations).toEqual(['basicInfo'])
    expect((await checkWorkspace({ directory, ...BINDING }, client)).planId).toBe(first.planId)
    expect((await checkWorkspace({ directory, ...BINDING })).planId).toBeUndefined()

    await editJson(appManifest(directory), app => {
      app.basicInfo.tagline = 'Another local tagline for customers'
    })
    expect((await checkWorkspace({ directory, ...BINDING }, client)).planId).not.toBe(first.planId)
  })

  it('keeps the local result when the portal comparison fails', async () => {
    const client = portal()
    vi.mocked(client.getVersion).mockRejectedValue(new Error('API request failed (503): unavailable'))

    const check = await checkWorkspace({ directory, ...BINDING }, client)
    expect(check.compared).toBe(true)
    expect(check.modules[0]).toMatchObject({ errors: [], remoteError: 'API request failed (503): unavailable' })
  })
})

describe('errorItems', () => {
  it('splits a listed validation failure into one entry per problem', () => {
    expect(errorItems(new Error('Configuration is invalid:\n- a is required\n- b is too long'))).toEqual([
      'a is required',
      'b is too long'
    ])
    expect(errorItems(new Error('Workspace state is missing.'))).toEqual(['Workspace state is missing.'])
  })
})
