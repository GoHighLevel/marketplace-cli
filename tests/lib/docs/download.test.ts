import { describe, expect, it } from 'vitest'

import { downloadDocText } from '../../../src/lib/docs/download.js'
import { DOCS, routeFetch } from '../../helpers/docs-fetch.js'

const PAGE = `${DOCS}/oauth/Billing.md`

describe('downloadDocText', () => {
  it('returns Markdown with its ETag and sends conditional and identifying headers', async () => {
    const fetch = routeFetch({
      [PAGE]: { body: '# Billing', headers: { 'content-type': 'text/markdown', etag: '"v2"' } }
    })

    await expect(downloadDocText(PAGE, { fetch, etag: '"v1"', userAgent: 'ghl-test/1.0' })).resolves.toEqual({
      status: 'modified',
      text: '# Billing',
      etag: '"v2"'
    })
    const headers = fetch.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers).toMatchObject({ 'if-none-match': '"v1"', 'user-agent': 'ghl-test/1.0' })
    expect(fetch.mock.calls[0][1]?.redirect).toBe('manual')
  })

  it('reports a 304 as not modified', async () => {
    const fetch = routeFetch({ [PAGE]: { status: 304 } })
    await expect(downloadDocText(PAGE, { fetch, etag: '"v1"' })).resolves.toEqual({ status: 'not-modified' })
  })

  it('treats the HTML app shell served for unknown pages as not found', async () => {
    const fetch = routeFetch({ [PAGE]: { body: '<!doctype html>', headers: { 'content-type': 'text/html' } } })
    await expect(downloadDocText(PAGE, { fetch })).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' })
  })

  it('maps HTTP failures to stable codes', async () => {
    await expect(downloadDocText(PAGE, { fetch: routeFetch({}) })).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' })
    await expect(downloadDocText(PAGE, { fetch: routeFetch({ [PAGE]: { status: 503 } }) })).rejects.toMatchObject({
      code: 'DOCS_UNAVAILABLE',
      message: expect.stringContaining('HTTP 503')
    })
  })

  it('follows redirects that stay inside the docs and refuses any other target', async () => {
    const moved = `${DOCS}/oauth/BillingV2.md`
    const following = routeFetch({
      [PAGE]: { status: 301, headers: { location: '/docs/oauth/BillingV2.md' } },
      [moved]: { body: 'moved' }
    })
    await expect(downloadDocText(PAGE, { fetch: following })).resolves.toMatchObject({ text: 'moved' })

    const escaping = routeFetch({ [PAGE]: { status: 302, headers: { location: 'https://evil.example.com/x.md' } } })
    await expect(downloadDocText(PAGE, { fetch: escaping })).rejects.toMatchObject({
      code: 'DOCS_UNAVAILABLE',
      message: expect.stringContaining('outside the HighLevel developer docs')
    })
  })

  it('stops reading a body that exceeds the byte limit', async () => {
    const fetch = routeFetch({ [PAGE]: { body: 'x'.repeat(2_000) } })
    await expect(downloadDocText(PAGE, { fetch, maxBytes: 1_000 })).rejects.toMatchObject({ code: 'DOC_TOO_LARGE' })
  })

  it('maps network failures and cancellation', async () => {
    const offline = routeFetch({
      [PAGE]: () => {
        throw new TypeError('fetch failed')
      }
    })
    await expect(downloadDocText(PAGE, { fetch: offline })).rejects.toMatchObject({
      code: 'DOCS_UNAVAILABLE',
      message: 'Cannot reach marketplace.gohighlevel.com.'
    })

    const controller = new AbortController()
    controller.abort()
    const aborted = routeFetch({
      [PAGE]: () => {
        throw new DOMException('aborted', 'AbortError')
      }
    })
    await expect(downloadDocText(PAGE, { fetch: aborted, signal: controller.signal })).rejects.toMatchObject({
      code: 'CANCELLED'
    })
  })
})
