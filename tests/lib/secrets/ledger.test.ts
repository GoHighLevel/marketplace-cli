import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  canRevealGeneratedSecretInteractively,
  consumeSecrets,
  isAppScoped,
  listSecrets,
  maskSecret,
  prepareGeneratedSecretOutput,
  recordSecret,
  removeSecrets,
  secretAppId,
  secretForOutput,
  storeSecretForOneTimeReveal,
  tryRecordSecret
} from '../../../src/lib/secrets/ledger.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-secrets-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('secret ledger', () => {
  it('records and lists secrets per profile, newest first', async () => {
    await recordSecret(dir, 'default', { kind: 'client-secret', label: 'prod-key', reference: 'app-1', value: 's1' })
    await recordSecret(dir, 'default', { kind: 'sandbox-password', label: 'Test Agency', value: 'p1' })
    await recordSecret(dir, 'other', { kind: 'sso-key', label: 'My App', value: 'k1' })

    const entries = await listSecrets(dir, 'default')
    expect(entries.map(entry => entry.kind)).toEqual(['sandbox-password', 'client-secret'])
    expect(entries[1]).toMatchObject({ label: 'prod-key', reference: 'app-1', value: 's1' })
    expect(entries[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(await listSecrets(dir, 'other')).toHaveLength(1)
    expect(await listSecrets(dir, 'unknown')).toEqual([])
  })

  it('writes the file with owner-only permissions', async () => {
    await recordSecret(dir, 'default', { kind: 'sso-key', label: 'My App', value: 'k1' })
    const stats = await fs.stat(path.join(dir, 'secrets.json'))
    expect(stats.mode & 0o777).toBe(0o600)
  })

  it('removes entries by kind + reference, and by kind + app for rotation', async () => {
    await recordSecret(dir, 'default', { kind: 'client-secret', label: 'k1', reference: 'app1-aaa', value: 's1' })
    await recordSecret(dir, 'default', { kind: 'client-secret', label: 'k2', reference: 'app1-bbb', value: 's2' })
    await recordSecret(dir, 'default', { kind: 'sso-key', label: 'App', reference: 'app1', value: 'old' })
    await recordSecret(dir, 'default', { kind: 'sandbox-password', label: 'Agency', value: 'p1' })

    expect(await removeSecrets(dir, 'default', { kind: 'client-secret', reference: 'app1-aaa' })).toBe(1)
    expect(await removeSecrets(dir, 'default', { kind: 'client-secret', reference: 'missing' })).toBe(0)
    expect(await removeSecrets(dir, 'default', { kind: 'sso-key', appId: 'app1' })).toBe(1)

    const remaining = await listSecrets(dir, 'default')
    expect(remaining.map(entry => entry.label)).toEqual(['Agency', 'k2'])
  })

  it('replaces rotated secrets in one write and reports best-effort storage failures', async () => {
    await recordSecret(dir, 'default', { kind: 'sso-key', label: 'App', appId: 'app1', value: 'old' })
    await expect(
      tryRecordSecret(
        dir,
        'default',
        { kind: 'sso-key', label: 'App', appId: 'app1', value: 'new' },
        { kind: 'sso-key', appId: 'app1' }
      )
    ).resolves.toBe(true)
    expect((await listSecrets(dir, 'default')).map(entry => entry.value)).toEqual(['new'])

    await fs.writeFile(path.join(dir, 'secrets.json'), 'invalid json')
    await expect(tryRecordSecret(dir, 'default', { kind: 'sso-key', label: 'App', value: 'ignored' })).resolves.toBe(
      false
    )
  })

  it('consumes matching secrets exactly once without deleting other scopes', async () => {
    await recordSecret(dir, 'default', {
      kind: 'client-secret',
      label: 'app-one',
      appId: 'app1',
      reference: 'app1-key',
      value: 'secret-one'
    })
    await recordSecret(dir, 'default', {
      kind: 'sso-key',
      label: 'app-one-sso',
      appId: 'app1',
      reference: 'app1',
      value: 'sso-one'
    })
    await recordSecret(dir, 'default', {
      kind: 'client-secret',
      label: 'app-two',
      appId: 'app2',
      reference: 'app2-key',
      value: 'secret-two'
    })

    const first = await consumeSecrets(dir, 'default', entry => secretAppId(entry) === 'app1')
    const second = await consumeSecrets(dir, 'default', entry => secretAppId(entry) === 'app1')

    expect(first.map(entry => entry.value).sort()).toEqual(['secret-one', 'sso-one'])
    expect(second).toEqual([])
    expect((await listSecrets(dir, 'default')).map(entry => entry.value)).toEqual(['secret-two'])
    expect(await fs.readFile(path.join(dir, 'secrets.json'), 'utf8')).not.toMatch(/secret-one|sso-one/)
  })

  it('allows only one concurrent consumer to receive a secret', async () => {
    await recordSecret(dir, 'default', {
      kind: 'client-secret',
      label: 'production',
      appId: 'app1',
      reference: 'app1-key',
      value: 'one-time'
    })

    const results = await Promise.all([
      consumeSecrets(dir, 'default', entry => secretAppId(entry) === 'app1'),
      consumeSecrets(dir, 'default', entry => secretAppId(entry) === 'app1')
    ])

    expect(results.filter(entries => entries.length === 1)).toHaveLength(1)
    expect(results.filter(entries => entries.length === 0)).toHaveLength(1)
  })

  it('does not retain a generated secret that was revealed during creation', async () => {
    const entry = {
      kind: 'client-secret' as const,
      label: 'production',
      appId: 'app1',
      reference: 'app1-key',
      value: 'one-time'
    }

    await expect(storeSecretForOneTimeReveal(dir, 'default', entry, true)).resolves.toBe(false)
    expect(await listSecrets(dir, 'default')).toEqual([])
    await expect(storeSecretForOneTimeReveal(dir, 'default', entry, false)).resolves.toBe(true)
    expect(await listSecrets(dir, 'default')).toHaveLength(1)
  })

  it('rejects a malformed secrets file instead of overwriting it', async () => {
    await fs.writeFile(path.join(dir, 'secrets.json'), JSON.stringify({ profiles: { default: 'nope' } }))
    await expect(recordSecret(dir, 'default', { kind: 'sso-key', label: 'My App', value: 'k1' })).rejects.toThrow(
      /unexpected format/i
    )
    await expect(listSecrets(dir, 'default')).rejects.toThrow(/unexpected format/i)
  })

  it('rejects unsupported versions, kinds, and profile names', async () => {
    await fs.writeFile(path.join(dir, 'secrets.json'), JSON.stringify({ version: 2, profiles: {} }))
    await expect(listSecrets(dir, 'default')).rejects.toThrow(/unexpected format/i)

    await fs.writeFile(
      path.join(dir, 'secrets.json'),
      JSON.stringify({
        version: 1,
        profiles: { default: [{ kind: 'api-key', label: 'bad', value: 'secret', createdAt: new Date().toISOString() }] }
      })
    )
    await expect(listSecrets(dir, 'default')).rejects.toThrow(/unexpected format/i)

    await expect(recordSecret(dir, 'bad profile', { kind: 'sso-key', label: 'My App', value: 'k1' })).rejects.toThrow(
      /profile name/i
    )

    await fs.writeFile(path.join(dir, 'secrets.json'), JSON.stringify({ version: 1, profiles: {} }))
    await expect(recordSecret(dir, 'default', { kind: 'sso-key', label: '', value: 'k1' })).rejects.toThrow(
      /secret entry/i
    )
  })
})

describe('maskSecret', () => {
  it('keeps only the last four characters of longer values', () => {
    expect(maskSecret('4af22b21-f457-448a-a081-341c3630abc6')).toBe('****abc6')
    expect(maskSecret('abcd')).toBe('****')
    expect(maskSecret('')).toBe('****')
  })

  it('reveals only when explicitly requested', () => {
    expect(secretForOutput('secret-value', true)).toBe('****alue')
    expect(secretForOutput('secret-value', true, true)).toBe('secret-value')
    expect(secretForOutput('secret-value', false)).toBe('****alue')
  })

  it('fails closed for generated secrets in automation when storage fails', () => {
    expect(prepareGeneratedSecretOutput('secret-value', false, false, false)).toEqual({
      value: '****alue',
      unavailable: true
    })
    expect(prepareGeneratedSecretOutput('secret-value', false, false, true)).toEqual({
      value: 'secret-value',
      unavailable: false
    })
    expect(prepareGeneratedSecretOutput('secret-value', false, true, false)).toEqual({
      value: 'secret-value',
      unavailable: false
    })
  })

  it('only uses the automatic fallback when both input and output are terminals', () => {
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    try {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
      expect(canRevealGeneratedSecretInteractively(false)).toBe(false)
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
      expect(canRevealGeneratedSecretInteractively(false)).toBe(true)
      expect(canRevealGeneratedSecretInteractively(true)).toBe(false)
    } finally {
      if (stdinTty) Object.defineProperty(process.stdin, 'isTTY', stdinTty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      if (stdoutTty) Object.defineProperty(process.stdout, 'isTTY', stdoutTty)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
    }
  })
})

describe('app scoping', () => {
  const at = new Date().toISOString()

  it('classifies client secrets and sso keys as app-scoped, sandbox passwords as account-level', () => {
    expect(isAppScoped({ kind: 'client-secret', label: 'k', value: 's', createdAt: at })).toBe(true)
    expect(isAppScoped({ kind: 'sso-key', label: 'k', value: 's', createdAt: at })).toBe(true)
    expect(isAppScoped({ kind: 'sandbox-password', label: 'a', value: 'p', createdAt: at })).toBe(false)
  })

  it('resolves the app from stored appId or, for legacy entries, the reference', () => {
    expect(secretAppId({ kind: 'client-secret', label: 'k', appId: 'app1', value: 's', createdAt: at })).toBe('app1')
    expect(
      secretAppId({ kind: 'client-secret', label: 'k', reference: 'app1-mshd9dai', value: 's', createdAt: at })
    ).toBe('app1')
    expect(secretAppId({ kind: 'sso-key', label: 'k', reference: 'app1', value: 's', createdAt: at })).toBe('app1')
    expect(secretAppId({ kind: 'sandbox-password', label: 'a', value: 'p', createdAt: at })).toBeUndefined()
  })
})
