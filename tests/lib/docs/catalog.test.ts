import { describe, expect, it } from 'vitest'

import { parseApiIndex, parseGuides } from '../../../src/lib/docs/catalog.js'
import { extractSection } from '../../../src/lib/docs/markdown.js'
import { API_INDEX_TEXT, DOCS, GUIDES_TEXT } from '../../helpers/docs-fetch.js'

describe('parseApiIndex', () => {
  it('reads every endpoint with its service, method, path, and summary', () => {
    const entries = parseApiIndex(API_INDEX_TEXT)

    expect(entries).toContainEqual({
      kind: 'api',
      title: 'Get Contact',
      url: `${DOCS}/ghl/contacts/get-contact.md`,
      section: 'contacts',
      method: 'GET',
      path: '/contacts/{contactId}',
      reference: `${DOCS}/llms/v3/contacts.md`,
      text: 'Get Contact'
    })
    expect(entries.find(entry => entry.title === 'Get Calendar Events')).toEqual(
      expect.not.objectContaining({ reference: expect.anything() })
    )
  })

  it('links endpoints to their compact service reference but never lists that bulky file itself', () => {
    const entries = parseApiIndex(API_INDEX_TEXT)
    expect(entries.map(entry => entry.title)).toEqual(['Get Contact', 'Create Contact', 'Get Calendar Events'])
    expect(entries.some(entry => entry.url.includes('/llms/'))).toBe(false)
  })

  it('drops links that leave the docs site', () => {
    expect(parseApiIndex('## x\n- [Bad](https://evil.example.com/a.md): GET /a')).toEqual([])
  })
})

describe('parseGuides', () => {
  it('splits inlined pages into an introduction entry and one entry per section', () => {
    const entries = parseGuides(GUIDES_TEXT)

    expect(entries.map(entry => entry.url)).toEqual([
      `${DOCS}/Authorization/Scopes.md`,
      `${DOCS}/Authorization/Scopes.md#requesting-scopes`,
      `${DOCS}/Authorization/Scopes.md#contact-scopes`,
      `${DOCS}/oauth/Billing.md`,
      `${DOCS}/oauth/Billing.md#signature-verification`
    ])
    expect(entries[2]).toEqual({
      kind: 'guide',
      title: 'Scopes › Contact scopes',
      url: `${DOCS}/Authorization/Scopes.md#contact-scopes`,
      section: 'Authorization',
      text: 'Use contacts.readonly to read contacts and contacts.write to change them.'
    })
    expect(entries[3].section).toBe('Marketplace apps')
  })

  it('ignores the contents list and headings inside code blocks', () => {
    const entries = parseGuides(GUIDES_TEXT)
    expect(entries.some(entry => entry.title.includes('Contents'))).toBe(false)
    expect(entries.some(entry => entry.title.includes('Example comment'))).toBe(false)
    expect(entries[1].text).toContain('curl https://services.leadconnectorhq.com')
  })

  it('numbers repeated headings exactly as the published page does, so every anchor resolves', () => {
    const page =
      '# Webhooks\n\nSource: https://marketplace.gohighlevel.com/docs/webhook/Webhooks\n\nIntro.\n\n## Webhooks\n\nSection body.\n\n## Webhooks\n\nSecond body.\n'
    const entries = parseGuides(page).filter(entry => entry.url.includes('#'))

    expect(entries.map(entry => entry.url.split('#')[1])).toEqual(['webhooks-1', 'webhooks-2'])
    for (const entry of entries) {
      expect(extractSection(page, entry.url.split('#')[1])).toContain(entry.text)
    }
  })
})
