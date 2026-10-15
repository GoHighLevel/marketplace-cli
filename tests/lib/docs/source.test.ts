import { describe, expect, it } from 'vitest'

import { formatDocUrl, resolveDocUrl } from '../../../src/lib/docs/source.js'
import { DOCS } from '../../helpers/docs-fetch.js'

describe('resolveDocUrl', () => {
  it.each([
    [`${DOCS}/oauth/Billing.md`, `${DOCS}/oauth/Billing.md`],
    [`${DOCS}/oauth/Billing`, `${DOCS}/oauth/Billing.md`],
    [`${DOCS}/oauth/Billing/`, `${DOCS}/oauth/Billing.md`],
    [`${DOCS}/oauth/Billing/index.html`, `${DOCS}/oauth/Billing.md`],
    [`${DOCS}/oauth/Billing.html`, `${DOCS}/oauth/Billing.md`],
    [`${DOCS}/llms/v3/llms.txt`, `${DOCS}/llms/v3/llms.txt`],
    [`  ${DOCS}/oauth/Billing?ref=search  `, `${DOCS}/oauth/Billing.md`]
  ])('maps %s to its Markdown source', (input, expected) => {
    expect(resolveDocUrl(input)).toEqual({ url: expected })
  })

  it('keeps a section anchor separately, decoded and lower-cased', () => {
    expect(resolveDocUrl(`${DOCS}/Authorization/Scopes#Contact-Scopes`)).toEqual({
      url: `${DOCS}/Authorization/Scopes.md`,
      anchor: 'contact-scopes'
    })
    expect(formatDocUrl({ url: `${DOCS}/a.md`, anchor: 'b' })).toBe(`${DOCS}/a.md#b`)
  })

  it.each([
    'http://marketplace.gohighlevel.com/docs/oauth/Billing.md',
    'https://evil.example.com/docs/oauth/Billing.md',
    'https://marketplace.gohighlevel.com.evil.example.com/docs/a.md',
    'https://user:pass@marketplace.gohighlevel.com/docs/a.md',
    'https://marketplace.gohighlevel.com:8443/docs/a.md',
    'https://marketplace.gohighlevel.com/api/secret.md',
    'https://marketplace.gohighlevel.com/docs/../admin.md',
    'https://marketplace.gohighlevel.com/docs/%2e%2e/admin.md',
    'https://marketplace.gohighlevel.com/docs/',
    'file:///etc/passwd',
    'not a url',
    `${DOCS}/${'a'.repeat(2100)}`
  ])('rejects %s', input => {
    expect(() => resolveDocUrl(input)).toThrow(expect.objectContaining({ code: 'INVALID_DOC_URL' }))
  })
})
