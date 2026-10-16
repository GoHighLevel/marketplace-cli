import { CodedError } from '../shared/errors.js'
import { isDocsUrl } from './source.js'

export interface DownloadOptions {
  fetch?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
  etag?: string
  userAgent?: string
}

export type DownloadResult = { status: 'modified'; text: string; etag?: string } | { status: 'not-modified' }

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const TEXT_CONTENT_TYPES = ['text/markdown', 'text/plain', 'text/x-markdown']

function isTextContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  return TEXT_CONTENT_TYPES.includes(mediaType)
}

/* Reads at most `maxBytes`, so an unexpectedly large response cannot exhaust
   memory before the size check runs. */
async function readLimitedText(response: Response, url: string, maxBytes: number): Promise<string> {
  const tooLarge = new CodedError('DOC_TOO_LARGE', `${url} is larger than ${maxBytes} bytes.`)
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw tooLarge
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel()
      throw tooLarge
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

function requestFailure(error: unknown, url: string, signal: AbortSignal | undefined): CodedError {
  if (error instanceof CodedError) return error
  if (signal?.aborted) return new CodedError('CANCELLED', 'The documentation request was cancelled.')
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new CodedError('DOCS_UNAVAILABLE', `Timed out fetching ${url}.`)
  }
  return new CodedError('DOCS_UNAVAILABLE', `Cannot reach ${new URL(url).host}.`)
}

/* Releases the connection of a response whose body will not be read. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

/* Missing pages are served as the HTML app shell with status 200, so the
   content type is what proves a page exists. */
function responseFailure(response: Response, url: string): CodedError | undefined {
  const missing = response.status === 404 || response.status === 410
  if (missing || (response.ok && !isTextContentType(response.headers.get('content-type')))) {
    return new CodedError('DOC_NOT_FOUND', `No documentation page exists at ${url}.`)
  }
  return response.ok ? undefined : new CodedError('DOCS_UNAVAILABLE', `${url} returned HTTP ${response.status}.`)
}

function redirectTarget(response: Response, current: string): string {
  const location = response.headers.get('location')
  const target = location ? new URL(location, current) : undefined
  if (!target || !isDocsUrl(target)) {
    throw new CodedError('DOCS_UNAVAILABLE', `${current} redirected outside the HighLevel developer docs.`)
  }
  return target.href
}

async function fetchFollowingDocsRedirects(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  let current = url
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchImpl(current, { ...init, redirect: 'manual' })
    if (!REDIRECT_STATUSES.has(response.status)) return response
    await discard(response)
    if (redirects === MAX_REDIRECTS) throw new CodedError('DOCS_UNAVAILABLE', `Too many redirects for ${url}.`)
    current = redirectTarget(response, current)
  }
}

/* Fetches one docs text file, following redirects only within the docs. */
export async function downloadDocText(url: string, options: DownloadOptions = {}): Promise<DownloadResult> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const headers: Record<string, string> = { accept: 'text/markdown, text/plain;q=0.9' }
  if (options.userAgent) headers['user-agent'] = options.userAgent
  if (options.etag) headers['if-none-match'] = options.etag

  try {
    const response = await fetchFollowingDocsRedirects(url, { headers, signal }, options.fetch ?? fetch)
    if (response.status === 304) return { status: 'not-modified' }
    const failure = responseFailure(response, url)
    if (failure) {
      await discard(response)
      throw failure
    }

    const text = await readLimitedText(response, url, options.maxBytes ?? DEFAULT_MAX_BYTES)
    const etag = response.headers.get('etag') ?? undefined
    return etag ? { status: 'modified', text, etag } : { status: 'modified', text }
  } catch (error) {
    throw requestFailure(error, url, options.signal)
  }
}
