import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { saveProfile } from '../../src/lib/auth/token-store.js'
import { listSecrets, recordSecret } from '../../src/lib/secrets/ledger.js'

const execFileAsync = promisify(execFile)
const cli = path.resolve('bin/run.js')
let configDir: string

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-reveal-'))
  await saveProfile(configDir, 'default', { accessToken: 'test-token', teamId: 'team1' })
})

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true })
})

describe('secrets reveal', () => {
  it('reveals a captured client secret once and removes it before a second invocation', async () => {
    await recordSecret(configDir, 'default', {
      kind: 'client-secret',
      label: 'production',
      appId: 'app1',
      reference: 'app1-key',
      value: 'client-secret-once'
    })

    const first = await execFileAsync(process.execPath, [cli, 'secrets', 'reveal', '--app', 'app1', '--force'], {
      env: { ...process.env, GHL_CONFIG_DIR: configDir, NO_COLOR: '1' }
    })
    expect(first.stdout).toContain('client-secret-once')
    expect(first.stdout).toMatch(/removed from local storage.*cannot be revealed again/is)
    expect(await listSecrets(configDir, 'default')).toEqual([])

    const second = await execFileAsync(process.execPath, [cli, 'secrets', 'reveal', '--app', 'app1', '--force'], {
      env: { ...process.env, GHL_CONFIG_DIR: configDir, NO_COLOR: '1' }
    })
    expect(second.stdout).not.toContain('client-secret-once')
    expect(second.stdout).toMatch(/no unrevealed secrets/i)
  })
})
