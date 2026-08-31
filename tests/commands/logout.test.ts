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
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-logout-'))
  await saveProfile(configDir, 'default', {
    accessToken: 'test-token',
    email: 'karankumar.kaneria@gohighlevel.com'
  })
  await recordSecret(configDir, 'default', {
    kind: 'client-secret',
    label: 'production',
    appId: 'app1',
    value: 'retained-secret'
  })
})

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true })
})

describe('logout', () => {
  it('prints only the account and reauthentication guidance after a successful logout', async () => {
    const result = await execFileAsync(process.execPath, [cli, 'logout'], {
      env: { ...process.env, GHL_CONFIG_DIR: configDir, NO_COLOR: '1' }
    })

    expect(result.stdout).toBe(
      'Logged out karankumar.kaneria@gohighlevel.com\n\nRun `ghl login` to authenticate again.\n'
    )
    expect(await listSecrets(configDir, 'default')).toHaveLength(1)
  })
})
