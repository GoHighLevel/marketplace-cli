import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '../../../src/lib/api/client.js'
import { createClientKeyInLedger, deleteClientKeyAndSecret, liveClientKeys } from '../../../src/lib/app/client-keys.js'
import type { AppContext } from '../../../src/lib/app/section-context.js'
import { listSecrets } from '../../../src/lib/secrets/ledger.js'
import { completeAppVersion } from '../../helpers/app-files.js'

let configDir: string

function context(dir = configDir): AppContext {
  const client = {
    activeProfileName: 'default',
    addClientKey: vi.fn(async () => ({ id: 'client-2', secret: 'top-secret' })),
    deleteClientKey: vi.fn(async () => undefined)
  } as unknown as ApiClient
  return {
    client,
    config: { portalUrl: '', apiUrl: '', oauthUrl: '', workflowsUrl: '', configDir: dir },
    selected: { appId: 'app-1', versionId: 'version-1' },
    version: completeAppVersion({
      clientKeys: [
        { id: 'client-1', name: 'Production', isDefault: true },
        { id: 'client-0', name: 'Old', deleted: true }
      ]
    })
  }
}

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-keys-'))
})

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true })
})

describe('client keys', () => {
  it('lists only keys that still work', () => {
    expect(liveClientKeys(context().version)).toEqual([{ id: 'client-1', name: 'Production' }])
  })

  it('keeps a new secret only in the ledger and returns the client id', async () => {
    await expect(createClientKeyInLedger(context(), 'Staging')).resolves.toBe('client-2')
    expect(await listSecrets(configDir, 'default')).toEqual([
      expect.objectContaining({ kind: 'client-secret', reference: 'client-2', appId: 'app-1', value: 'top-secret' })
    ])
  })

  it('deletes a key again when its secret cannot be kept', async () => {
    const unwritable = path.join(configDir, 'file')
    await fs.writeFile(unwritable, '')
    const keys = context(unwritable)
    await expect(createClientKeyInLedger(keys, 'Staging')).rejects.toThrow(/new key was deleted again/)
    expect(keys.client.deleteClientKey).toHaveBeenCalledWith('app-1', 'client-2')
  })

  it('deletes a known key and prunes its secret', async () => {
    const keys = context()
    await createClientKeyInLedger(keys, 'Staging')
    await expect(
      deleteClientKeyAndSecret(
        { ...keys, version: completeAppVersion({ clientKeys: [{ id: 'client-2' }] }) },
        'client-2'
      )
    ).resolves.toBe(true)
    expect(await listSecrets(configDir, 'default')).toEqual([])
    await expect(deleteClientKeyAndSecret(keys, 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('Client key "missing" was not found')
    })
  })
})
