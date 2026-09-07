import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SecretsReveal from '../../src/commands/secrets/reveal.js'
import { saveProfile } from '../../src/lib/auth/token-store.js'
import { listSecrets, recordSecret } from '../../src/lib/secrets/ledger.js'

let configDir: string

async function runSecretsReveal(): Promise<string> {
  const output: string[] = []
  const log = vi.spyOn(SecretsReveal.prototype, 'log').mockImplementation((message = '') => {
    output.push(message)
  })

  try {
    await SecretsReveal.run(['--app', 'app1', '--force'], { root: path.resolve('.') })
  } finally {
    log.mockRestore()
  }

  return output.join('\n')
}

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-reveal-'))
  vi.stubEnv('GHL_CONFIG_DIR', configDir)
  vi.stubEnv('NO_COLOR', '1')
  await saveProfile(configDir, 'default', { accessToken: 'test-token', teamId: 'team1' })
})

afterEach(async () => {
  vi.unstubAllEnvs()
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

    const first = await runSecretsReveal()
    expect(first).toContain('client-secret-once')
    expect(first).toMatch(/removed from local storage.*cannot be revealed again/is)
    expect(await listSecrets(configDir, 'default')).toEqual([])

    const second = await runSecretsReveal()
    expect(second).not.toContain('client-secret-once')
    expect(second).toMatch(/no unrevealed secrets/i)
  })
})
