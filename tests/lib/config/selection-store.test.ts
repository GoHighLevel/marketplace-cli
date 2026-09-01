import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearSelectedApp, getSelectedApp, saveSelectedApp } from '../../../src/lib/config/selection-store.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-config-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('config store', () => {
  it('returns undefined when nothing is selected', async () => {
    expect(await getSelectedApp(dir, 'default')).toBeUndefined()
  })

  it('round-trips a selection per profile', async () => {
    await saveSelectedApp(dir, 'default', { appId: 'a1', versionId: 'v1', name: 'App One' })
    await saveSelectedApp(dir, 'staging', { appId: 'a2', versionId: 'v2', name: 'App Two' })

    expect(await getSelectedApp(dir, 'default')).toEqual({ appId: 'a1', versionId: 'v1', name: 'App One' })
    expect(await getSelectedApp(dir, 'staging')).toEqual({ appId: 'a2', versionId: 'v2', name: 'App Two' })
  })

  it('overwrites the previous selection for a profile', async () => {
    await saveSelectedApp(dir, 'default', { appId: 'a1', versionId: 'v1' })
    await saveSelectedApp(dir, 'default', { appId: 'a9', versionId: 'v9' })
    expect((await getSelectedApp(dir, 'default'))?.appId).toBe('a9')
  })

  it('clears only the switched profile app selection', async () => {
    await saveSelectedApp(dir, 'default', { appId: 'a1', versionId: 'v1' })
    await saveSelectedApp(dir, 'staging', { appId: 'a2', versionId: 'v2' })

    expect(await clearSelectedApp(dir, 'default')).toBe(true)
    expect(await clearSelectedApp(dir, 'default')).toBe(false)
    expect(await getSelectedApp(dir, 'default')).toBeUndefined()
    expect((await getSelectedApp(dir, 'staging'))?.appId).toBe('a2')
  })

  it('rejects structurally invalid selections', async () => {
    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({ version: 1, profiles: { default: { selectedApp: { appId: 'a1' } } } })
    )
    await expect(getSelectedApp(dir, 'default')).rejects.toThrow(/config\.json.*invalid structure/i)
  })

  it('rejects invalid stored profile names and optional app names', async () => {
    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({ version: 1, profiles: { 'bad profile': { selectedApp: { appId: 'a1', versionId: 'v1' } } } })
    )
    await expect(getSelectedApp(dir, 'default')).rejects.toThrow(/invalid structure/i)

    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({ version: 1, profiles: { default: { selectedApp: { appId: 'a1', versionId: 'v1', name: 1 } } } })
    )
    await expect(getSelectedApp(dir, 'default')).rejects.toThrow(/invalid structure/i)
  })

  it('rejects an invalid selection before writing it', async () => {
    await expect(saveSelectedApp(dir, 'default', { appId: '', versionId: 'v1' })).rejects.toThrow(/selection/i)
  })
})
