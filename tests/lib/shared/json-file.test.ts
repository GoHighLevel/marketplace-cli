import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readJsonFile, writeJsonFileAtomic } from '../../../src/lib/shared/json-file.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-json-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('JSON files', () => {
  it('returns undefined only when the file does not exist', async () => {
    await expect(readJsonFile(path.join(dir, 'missing.json'))).resolves.toBeUndefined()
  })

  it('reports corrupt JSON with the file path instead of treating it as missing', async () => {
    const file = path.join(dir, 'credentials.json')
    await fs.writeFile(file, '{broken')
    await expect(readJsonFile(file)).rejects.toThrow(/credentials\.json.*invalid JSON/i)
  })

  it('round-trips an atomic restrictive write without leaving temp files', async () => {
    const file = path.join(dir, 'nested', 'config.json')
    await writeJsonFileAtomic(file, { ok: true })
    await expect(readJsonFile(file)).resolves.toEqual({ ok: true })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    expect((await fs.readdir(path.dirname(file))).filter(name => name.includes('.tmp'))).toEqual([])
  })
})
