import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearStoredSession, loadCredentials, saveProfile } from '../../../src/lib/auth/token-store.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-test-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('token store', () => {
  it('returns an empty credentials file when none exists', async () => {
    const creds = await loadCredentials(dir)
    expect(creds.profiles).toEqual({})
    expect(creds.activeProfile).toBe('default')
  })

  it('clearStoredSession removes credentials and app selection but never the secret ledger', async () => {
    await saveProfile(dir, 'default', { accessToken: 'jwt' })
    await fs.writeFile(path.join(dir, 'config.json'), '{}')
    await fs.writeFile(path.join(dir, 'secrets.json'), '{}')

    const removed = await clearStoredSession(dir)
    expect(removed.sort()).toEqual(['config.json', 'credentials.json'])

    const remaining = await fs.readdir(dir)
    expect(remaining).toEqual(['secrets.json'])

    /* After logout the CLI reports a clean not-logged-in state. */
    const creds = await loadCredentials(dir)
    expect(creds.profiles).toEqual({})

    /* Idempotent: logging out twice removes nothing further and does not throw. */
    expect(await clearStoredSession(dir)).toEqual([])
  })

  it('round-trips a saved profile', async () => {
    await saveProfile(dir, 'default', { accessToken: 'jwt', refreshToken: 'ref', email: 'a@b.c' })
    const creds = await loadCredentials(dir)
    expect(creds.profiles.default.accessToken).toBe('jwt')
    expect(creds.profiles.default.email).toBe('a@b.c')
    expect(creds.activeProfile).toBe('default')
  })

  it('writes the credentials file with 0600 permissions', async () => {
    await saveProfile(dir, 'default', { accessToken: 'jwt' })
    const stat = await fs.stat(path.join(dir, 'credentials.json'))
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('keeps existing profiles when saving a new one', async () => {
    await saveProfile(dir, 'default', { accessToken: 'a' })
    await saveProfile(dir, 'staging', { accessToken: 'b' })
    const creds = await loadCredentials(dir)
    expect(Object.keys(creds.profiles)).toEqual(['default', 'staging'])
    expect(creds.activeProfile).toBe('staging')
  })

  it('rejects structurally invalid credentials instead of treating them as logged out', async () => {
    await fs.writeFile(path.join(dir, 'credentials.json'), JSON.stringify({ version: 1, profiles: [] }))
    await expect(loadCredentials(dir)).rejects.toThrow(/credentials\.json.*invalid structure/i)
  })

  it('rejects invalid profile names and optional field types in stored credentials', async () => {
    await fs.writeFile(
      path.join(dir, 'credentials.json'),
      JSON.stringify({ version: 1, activeProfile: 'bad profile', profiles: { 'bad profile': { accessToken: 'jwt' } } })
    )
    await expect(loadCredentials(dir)).rejects.toThrow(/invalid structure/i)

    await fs.writeFile(
      path.join(dir, 'credentials.json'),
      JSON.stringify({ version: 1, activeProfile: 'default', profiles: { default: { accessToken: 'jwt', expiresAt: 'soon' } } })
    )
    await expect(loadCredentials(dir)).rejects.toThrow(/invalid structure/i)
  })

  it('rejects invalid profile data before writing it', async () => {
    await expect(saveProfile(dir, 'default', { accessToken: '' })).rejects.toThrow(/profile data/i)
    await expect(saveProfile(dir, 'default', { accessToken: 'jwt', teamId: 123 } as never)).rejects.toThrow(/profile data/i)
  })
})
