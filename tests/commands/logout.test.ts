import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Config } from '@oclif/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Logout from '../../src/commands/logout.js'
import { saveProfile } from '../../src/lib/auth/token-store.js'
import { listSecrets, recordSecret } from '../../src/lib/secrets/ledger.js'

let configDir: string

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-logout-'))
  vi.stubEnv('GHL_CONFIG_DIR', configDir)
  vi.stubEnv('NO_COLOR', '1')
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
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await fs.rm(configDir, { recursive: true, force: true })
})

describe('logout', () => {
  it('prints only the account and reauthentication guidance after a successful logout', async () => {
    const output: string[] = []
    const log = vi.spyOn(Logout.prototype, 'log').mockImplementation((message = '') => {
      output.push(message)
    })
    const config = await Config.load({ root: path.resolve('.') })
    await new Logout([], config).run()

    expect(output.join('\n')).toBe(
      'Logged out karankumar.kaneria@gohighlevel.com\n\nRun `ghl login` to authenticate again.'
    )
    expect(await listSecrets(configDir, 'default')).toHaveLength(1)
  })
})
