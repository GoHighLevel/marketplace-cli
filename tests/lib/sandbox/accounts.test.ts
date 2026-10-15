import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '../../../src/lib/api/client.js'
import {
  createSandboxInLedger,
  deleteSandboxAndSecret,
  findSandbox,
  generateSandboxPassword
} from '../../../src/lib/sandbox/accounts.js'
import { listSecrets } from '../../../src/lib/secrets/ledger.js'
import { validateSandboxPassword } from '../../../src/lib/shared/validation.js'

const ACCOUNT = { _id: 'sandbox-1', name: 'Test agency', companyId: 'company-1' }
let configDir: string

function fakeClient(): ApiClient {
  return {
    activeProfileName: 'default',
    createSandboxAccount: vi.fn(async () => ACCOUNT),
    deleteSandboxAccount: vi.fn(async () => undefined)
  } as unknown as ApiClient
}

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-sandbox-'))
})

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true })
})

describe('generateSandboxPassword', () => {
  it('meets the portal rules and differs every time', () => {
    const passwords = Array.from({ length: 20 }, generateSandboxPassword)
    expect(passwords.every(password => password.length === 20 && validateSandboxPassword(password) === true)).toBe(true)
    expect(new Set(passwords).size).toBe(passwords.length)
  })
})

describe('createSandboxInLedger', () => {
  it('creates the sandbox with a generated password kept only in the ledger', async () => {
    const client = fakeClient()
    await expect(createSandboxInLedger(client, configDir, 'Test agency')).resolves.toEqual(ACCOUNT)

    const [, password] = vi.mocked(client.createSandboxAccount).mock.calls[0]
    expect(await listSecrets(configDir, 'default')).toEqual([
      expect.objectContaining({ kind: 'sandbox-password', reference: 'company-1', value: password })
    ])
  })

  it('deletes the sandbox again when its password cannot be kept', async () => {
    const client = fakeClient()
    const unwritable = path.join(configDir, 'file')
    await fs.writeFile(unwritable, '')
    await expect(createSandboxInLedger(client, unwritable, 'Test agency')).rejects.toThrow(
      'The sandbox password could not be saved locally, so the new sandbox was deleted again.'
    )
    expect(client.deleteSandboxAccount).toHaveBeenCalledWith('sandbox-1')
  })
})

describe('deleteSandboxAndSecret', () => {
  it('deletes by record id, prunes the password, and finds sandboxes by either id', async () => {
    const client = fakeClient()
    await createSandboxInLedger(client, configDir, 'Test agency')

    expect(findSandbox([ACCOUNT], 'company-1')).toBe(ACCOUNT)
    expect(findSandbox([ACCOUNT], 'sandbox-1')).toBe(ACCOUNT)
    expect(findSandbox([ACCOUNT], 'other')).toBeUndefined()
    await expect(deleteSandboxAndSecret(client, configDir, ACCOUNT)).resolves.toBe(true)
    expect(client.deleteSandboxAccount).toHaveBeenCalledWith('sandbox-1')
    expect(await listSecrets(configDir, 'default')).toEqual([])
  })
})
