import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DocsService } from '../../../src/lib/docs/service.js'
import { API_INDEX, DOCS, docsRoutes, GUIDES, routeFetch, SCOPES_PAGE } from '../../helpers/docs-fetch.js'

const HOUR = 60 * 60 * 1000
let cacheDir: string

beforeEach(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-docs-service-'))
})

afterEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true })
})

function service(fetch: typeof globalThis.fetch, now = () => 0): DocsService {
  return new DocsService({ cacheDir, userAgent: 'ghl-test', fetch, now, indexMaxAgeMs: HOUR })
}

function indexCalls(fetch: ReturnType<typeof routeFetch>): number {
  return fetch.mock.calls.filter(([url]) => url === API_INDEX || url === GUIDES).length
}

describe('DocsService.search', () => {
  it('returns ranked results with excerpts and index metadata', async () => {
    const response = await service(routeFetch(docsRoutes())).search({ query: 'contact scopes', limit: 2 })

    expect(response).toMatchObject({ query: 'contact scopes', stale: false, indexedAt: new Date(0).toISOString() })
    expect(response.results[0]).toEqual({
      title: 'Scopes › Contact scopes',
      url: `${DOCS}/Authorization/Scopes.md#contact-scopes`,
      kind: 'guide',
      section: 'Authorization',
      excerpt: 'Use contacts.readonly to read contacts and contacts.write to change them.'
    })
    expect(response.results).toHaveLength(2)
  })

  it('includes method and path for API endpoints and honours the kind filter', async () => {
    const response = await service(routeFetch(docsRoutes())).search({
      query: 'GET /contacts/{id}',
      limit: 1,
      kind: 'api'
    })
    expect(response.results[0]).toMatchObject({ kind: 'api', method: 'GET', path: '/contacts/{contactId}' })
  })

  it('loads the index once for concurrent searches and reuses it while fresh', async () => {
    const fetch = routeFetch(docsRoutes())
    const docs = service(fetch)

    await Promise.all([docs.search({ query: 'scopes', limit: 1 }), docs.search({ query: 'billing', limit: 1 })])
    await docs.search({ query: 'contact', limit: 1 })
    expect(indexCalls(fetch)).toBe(2)
  })

  it('rebuilds an expired index and retries after a failed load', async () => {
    let now = 0
    let online = false
    const routes = docsRoutes()
    const fetch = routeFetch({
      [API_INDEX]: () => (online ? routes[API_INDEX] : failNetwork()),
      [GUIDES]: () => (online ? routes[GUIDES] : failNetwork())
    })
    const docs = service(fetch, () => now)

    await expect(docs.search({ query: 'scopes', limit: 1 })).rejects.toMatchObject({ code: 'DOCS_UNAVAILABLE' })
    online = true
    await expect(docs.search({ query: 'scopes', limit: 1 })).resolves.toMatchObject({ stale: false })

    now = 2 * HOUR
    const calls = indexCalls(fetch)
    await docs.search({ query: 'scopes', limit: 1 })
    expect(indexCalls(fetch)).toBe(calls + 2)
  })

  it('keeps serving the last good index, marked stale, when a rebuild fails', async () => {
    let now = 0
    let broken = false
    const routes = docsRoutes()
    const fetch = routeFetch({
      [API_INDEX]: () => (broken ? { status: 500 } : routes[API_INDEX]),
      [GUIDES]: () => (broken ? { status: 500 } : routes[GUIDES])
    })
    const docs = service(fetch, () => now)
    await docs.search({ query: 'scopes', limit: 1 })

    broken = true
    now = 2 * HOUR
    await expect(docs.search({ query: 'scopes', limit: 1 })).resolves.toMatchObject({
      stale: true,
      results: [{ url: expect.stringContaining('/Authorization/Scopes.md') }]
    })
  })

  it('stops before ranking when the request was cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      service(routeFetch(docsRoutes())).search({ query: 'scopes', limit: 1 }, controller.signal)
    ).rejects.toThrow()
  })
})

describe('DocsService.fetchPages', () => {
  const scopes = `${DOCS}/Authorization/Scopes.md`
  const createContact = `${DOCS}/ghl/contacts/create-contact.md`
  const read = (docs: DocsService, pages: string[], options: { startIndex?: number; maxLength?: number } = {}) =>
    docs.fetchPages({ pages, startIndex: options.startIndex ?? 0, maxLength: options.maxLength ?? 30_000 })
  const downloads = (fetch: ReturnType<typeof routeFetch>, suffix: string) =>
    fetch.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length

  it('returns a small page whole, even for an anchored URL, so follow-ups need no second call', async () => {
    const [page] = await read(service(routeFetch(docsRoutes())), [`${DOCS}/Authorization/Scopes#contact-scopes`])
    expect(page).toEqual({
      url: scopes,
      content: SCOPES_PAGE,
      startIndex: 0,
      endIndex: SCOPES_PAGE.length,
      totalLength: SCOPES_PAGE.length
    })
  })

  it('answers an endpoint page from the compact service reference instead of the full page', async () => {
    const fetch = routeFetch(docsRoutes())
    const [page] = await read(service(fetch), [createContact])

    expect(page.url).toBe(createContact)
    expect(page.content).toMatch(/^### Create Contact\nPOST \/contacts\/[\s\S]*Scopes: contacts\.write$/)
    expect(downloads(fetch, '/llms/v3/contacts.md')).toBe(1)
    expect(downloads(fetch, '/create-contact.md')).toBe(0)
  })

  it('falls back to the endpoint page itself when the index cannot load', async () => {
    const routes = docsRoutes()
    const fetch = routeFetch({ [createContact]: routes[createContact] })
    const [page] = await read(service(fetch), [createContact])
    expect(page.content.startsWith('# Create Contact')).toBe(true)
  })

  it('reads several pages in one call within one shared budget, once per unique URL', async () => {
    const pages = await read(service(routeFetch(docsRoutes())), [scopes, createContact, `${scopes}?ref=x`], {
      maxLength: 2_000
    })
    expect(pages.map(page => page.url)).toEqual([scopes, createContact])
    expect(pages.reduce((total, page) => total + page.content.length, 0)).toBeLessThanOrEqual(2_000)
  })

  it('continues one truncated page from startIndex and refuses an offset for several pages', async () => {
    const docs = service(routeFetch(docsRoutes()))
    const [first] = await read(docs, [scopes], { maxLength: 60 })
    const [second] = await read(docs, [scopes], { startIndex: first.nextStartIndex ?? 0 })

    expect(first.content + second.content).toBe(SCOPES_PAGE)
    expect(second.nextStartIndex).toBeUndefined()
    await expect(read(docs, [scopes, createContact], { startIndex: 10 })).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
  })

  it('shares one download between concurrent reads and retries after a failed download', async () => {
    const fetch = routeFetch(docsRoutes())
    const docs = service(fetch)
    await Promise.all([read(docs, [scopes]), read(docs, [scopes])])
    expect(downloads(fetch, 'Scopes.md')).toBe(1)

    let available = false
    const flaky = service(routeFetch({ [scopes]: () => (available ? { body: '# Scopes' } : { status: 503 }) }))
    await expect(read(flaky, [scopes])).rejects.toMatchObject({ code: 'DOCS_UNAVAILABLE' })
    available = true
    await expect(read(flaky, [scopes])).resolves.toMatchObject([{ content: '# Scopes' }])
  })

  it('resolves endpoint request lines to every documented page they name', async () => {
    const docs = service(routeFetch(docsRoutes()))
    const [post] = await read(docs, ['POST https://services.leadconnectorhq.com/contacts/?locationId=x'])
    expect(post.url).toBe(createContact)

    const pages = await read(docs, ['/contacts/{contactId}', 'GET /contacts/abc123'])
    expect(pages.map(page => page.url)).toEqual([`${DOCS}/ghl/contacts/get-contact.md`])
  })

  it('reports unresolvable pages in place and fails only when every page fails', async () => {
    const docs = service(routeFetch(docsRoutes()))
    const pages = await read(docs, ['https://evil.example.com/a.md', 'DELETE /contacts/', scopes])
    expect(pages.map(page => page.error?.split(':')[0])).toEqual(['INVALID_DOC_URL', 'ENDPOINT_NOT_FOUND', undefined])
    expect(pages[2].content).toBe(SCOPES_PAGE)

    await expect(read(docs, ['DELETE /contacts/'])).rejects.toMatchObject({ code: 'ENDPOINT_NOT_FOUND' })
  })

  it('serves CLI workspace references locally, by section, without any download', async () => {
    const fetch = routeFetch(docsRoutes())
    const [section, schema] = await read(service(fetch), [
      'ghl-cli:workflow-actions#dynamic-input',
      'ghl-cli:schema/app'
    ])

    expect(section).toMatchObject({ url: 'ghl-cli:workflow-actions#dynamic-input', outline: expect.any(Array) })
    expect(section.content.startsWith('## Dynamic input\n')).toBe(true)
    expect(JSON.parse(schema.content)).toMatchObject({ title: 'HighLevel App Manifest' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('finds CLI workspace references through search', async () => {
    const response = await service(routeFetch(docsRoutes())).search({
      query: 'workflow action dynamic input',
      limit: 1,
      kind: 'cli'
    })
    expect(response.results[0]).toMatchObject({ kind: 'cli', url: 'ghl-cli:workflow-actions#dynamic-input' })
  })

  it('refuses oversized requests before any work, whoever the caller is', async () => {
    const fetch = routeFetch(docsRoutes())
    const docs = service(fetch)
    const page = `${DOCS}/oauth/Scopes.md`

    for (const request of [
      () => docs.search({ query: 'x'.repeat(301), limit: 5 }),
      () => docs.search({ query: 'contacts', limit: 11 }),
      () => docs.fetchPages({ pages: Array.from({ length: 6 }, () => page), startIndex: 0, maxLength: 30_000 }),
      () => docs.fetchPages({ pages: [`${page}#${'a'.repeat(2048)}`], startIndex: 0, maxLength: 30_000 })
    ]) {
      await expect(request()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects URLs outside the docs before any request', async () => {
    const fetch = routeFetch(docsRoutes())
    await expect(read(service(fetch), ['https://evil.example.com/docs/a.md'])).rejects.toMatchObject({
      code: 'INVALID_DOC_URL'
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

function failNetwork(): never {
  throw new TypeError('fetch failed')
}
