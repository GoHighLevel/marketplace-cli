import { createHash } from 'node:crypto'
import path from 'node:path'

import { isRecord } from '../api/response.js'
import { CodedError } from '../shared/errors.js'
import { readJsonFile, writeJsonFileAtomic } from '../shared/json-file.js'
import { downloadDocText, type DownloadOptions, type DownloadResult } from './download.js'

export interface CachedTextOptions extends Omit<DownloadOptions, 'etag'> {
  cacheDir: string
  maxAgeMs: number
  now?: () => number
}

export interface CachedText {
  text: string
  fetchedAt: number
  /* True when the network failed and an expired copy was served instead. */
  stale: boolean
}

interface CacheRecord {
  url: string
  fetchedAt: number
  etag?: string
  text: string
}

/* A timestamp in the future (clock change, corrupt record) is never fresh,
   so it cannot pin an old copy until the clock catches up. */
export function isFresh(since: number, now: number, maxAgeMs: number): boolean {
  const age = now - since
  return age >= 0 && age < maxAgeMs
}

function cacheFile(cacheDir: string, url: string): string {
  return path.join(cacheDir, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`)
}

function isCacheRecord(value: unknown, url: string): value is CacheRecord {
  return (
    isRecord(value) &&
    value.url === url &&
    typeof value.fetchedAt === 'number' &&
    Number.isFinite(value.fetchedAt) &&
    typeof value.text === 'string' &&
    (value.etag === undefined || typeof value.etag === 'string')
  )
}

/* A corrupt or unreadable cache entry is a cache miss, never a failure. */
async function readRecord(file: string, url: string): Promise<CacheRecord | undefined> {
  try {
    const value = await readJsonFile<unknown>(file)
    return isCacheRecord(value, url) ? value : undefined
  } catch {
    return undefined
  }
}

/* The cache only saves bandwidth; a read-only or full disk must not turn a
   successful download into a failed tool call. */
async function writeRecord(file: string, record: CacheRecord): Promise<void> {
  await writeJsonFileAtomic(file, record).catch(() => undefined)
}

function nextRecord(url: string, result: DownloadResult, cached: CacheRecord | undefined, now: number): CacheRecord {
  if (result.status === 'modified') {
    return { url, fetchedAt: now, text: result.text, ...(result.etag ? { etag: result.etag } : {}) }
  }
  if (!cached) throw new CodedError('DOCS_UNAVAILABLE', `${url} answered 304 without a cached copy.`)
  return { ...cached, fetchedAt: now }
}

async function refreshRecord(
  url: string,
  file: string,
  cached: CacheRecord | undefined,
  options: CachedTextOptions,
  now: number
): Promise<CacheRecord> {
  const result = await downloadDocText(url, { ...options, etag: cached?.etag })
  const record = nextRecord(url, result, cached, now)
  await writeRecord(file, record)
  return record
}

/* Serves a fresh cached copy without touching the network, revalidates an
   expired one with its ETag, and falls back to the expired copy offline. */
export async function loadCachedText(url: string, options: CachedTextOptions): Promise<CachedText> {
  const now = (options.now ?? Date.now)()
  const file = cacheFile(options.cacheDir, url)
  const cached = await readRecord(file, url)
  if (cached && isFresh(cached.fetchedAt, now, options.maxAgeMs)) {
    return { text: cached.text, fetchedAt: cached.fetchedAt, stale: false }
  }

  try {
    const record = await refreshRecord(url, file, cached, options, now)
    return { text: record.text, fetchedAt: record.fetchedAt, stale: false }
  } catch (error) {
    const recoverable = error instanceof CodedError && error.code === 'DOCS_UNAVAILABLE'
    if (cached && recoverable) return { text: cached.text, fetchedAt: cached.fetchedAt, stale: true }
    throw error
  }
}
