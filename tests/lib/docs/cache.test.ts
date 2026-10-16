import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isFresh, loadCachedText } from '../../../src/lib/docs/cache.js'
import { DOCS, routeFetch } from '../../helpers/docs-fetch.js'

const URL = `${DOCS}/llms/guides.txt`
const HOUR = 60 * 60 * 1000
let cacheDir: string

beforeEach(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-docs-cache-'))
})

afterEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true })
})

function options(fetch: typeof globalThis.fetch, now: number) {
  return { cacheDir, maxAgeMs: HOUR, fetch, now: () => now }
}

describe('loadCachedText', () => {
  it('downloads once and serves fresh copies from disk without the network', async () => {
    const fetch = routeFetch({ [URL]: { body: 'v1', headers: { etag: '"1"' } } })

    await expect(loadCachedText(URL, options(fetch, 0))).resolves.toEqual({ text: 'v1', fetchedAt: 0, stale: false })
    await expect(loadCachedText(URL, options(fetch, HOUR - 1))).resolves.toMatchObject({ text: 'v1' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never treats a timestamp from the future as fresh', async () => {
    expect(isFresh(10, 5, HOUR)).toBe(false)
    expect(isFresh(5, 5, HOUR)).toBe(true)
    await loadCachedText(URL, options(routeFetch({ [URL]: { body: 'v1' } }), 10 * HOUR))
    const refreshed = routeFetch({ [URL]: { body: 'v2' } })
    await expect(loadCachedText(URL, options(refreshed, 0))).resolves.toMatchObject({ text: 'v2' })
  })

  it('revalidates an expired copy with its ETag and keeps it on 304', async () => {
    const first = routeFetch({ [URL]: { body: 'v1', headers: { etag: '"1"' } } })
    await loadCachedText(URL, options(first, 0))

    const revalidate = routeFetch({ [URL]: { status: 304 } })
    await expect(loadCachedText(URL, options(revalidate, 2 * HOUR))).resolves.toEqual({
      text: 'v1',
      fetchedAt: 2 * HOUR,
      stale: false
    })
    expect((revalidate.mock.calls[0][1]?.headers as Record<string, string>)['if-none-match']).toBe('"1"')
  })

  it('serves the expired copy as stale when the docs site is unreachable', async () => {
    await loadCachedText(URL, options(routeFetch({ [URL]: { body: 'v1' } }), 0))
    const offline = routeFetch({
      [URL]: () => {
        throw new TypeError('fetch failed')
      }
    })

    await expect(loadCachedText(URL, options(offline, 2 * HOUR))).resolves.toEqual({
      text: 'v1',
      fetchedAt: 0,
      stale: true
    })
  })

  it('fails without a cached copy, and treats a corrupt cache file as missing', async () => {
    const offline = routeFetch({
      [URL]: () => {
        throw new TypeError('fetch failed')
      }
    })
    await expect(loadCachedText(URL, options(offline, 0))).rejects.toMatchObject({ code: 'DOCS_UNAVAILABLE' })

    await loadCachedText(URL, options(routeFetch({ [URL]: { body: 'v1' } }), 0))
    const [file] = await fs.readdir(cacheDir)
    await fs.writeFile(path.join(cacheDir, file), '{broken')
    await expect(loadCachedText(URL, options(routeFetch({ [URL]: { body: 'v2' } }), 1))).resolves.toMatchObject({
      text: 'v2'
    })
  })

  it('still returns downloaded text when the cache directory cannot be written', async () => {
    const blocked = path.join(cacheDir, 'not-a-directory')
    await fs.writeFile(blocked, '')
    const result = await loadCachedText(URL, {
      cacheDir: blocked,
      maxAgeMs: HOUR,
      fetch: routeFetch({ [URL]: { body: 'v1' } })
    })
    expect(result.text).toBe('v1')
  })
})
