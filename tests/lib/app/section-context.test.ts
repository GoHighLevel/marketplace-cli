import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClient } from '../../../src/lib/api/client.js'
import { getSelectedApp } from '../../../src/lib/config/selection-store.js'
import { AppContext, followVersionChange } from '../../../src/lib/app/section-context.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-section-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('followVersionChange', () => {
  it('updates both persisted and in-memory context so multi-section operations use the new draft', async () => {
    const context = {
      client: { activeProfileName: 'default' } as ApiClient,
      config: { apiUrl: '', oauthUrl: '', portalUrl: '', configDir: dir },
      selected: { appId: 'a1', versionId: 'live1', name: 'App' },
      version: { _id: 'live1' }
    } satisfies AppContext

    const log = vi.fn()
    await followVersionChange(context, { oAuthClient: { _id: 'draft2', appId: 'a1' } }, log)

    expect(context.selected.versionId).toBe('draft2')
    expect((await getSelectedApp(dir, 'default'))?.versionId).toBe('draft2')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('draft2'))
  })
})
