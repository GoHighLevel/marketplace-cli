import { describe, expect, it } from 'vitest'

import type { DocEntry } from '../../../src/lib/docs/catalog.js'
import { parseApiIndex, parseGuides } from '../../../src/lib/docs/catalog.js'
import {
  buildSearchIndex,
  findEndpoints,
  normalizeApiPath,
  parseEndpointReference,
  searchIndex,
  tokenize
} from '../../../src/lib/docs/search.js'
import { API_INDEX_TEXT, GUIDES_TEXT } from '../../helpers/docs-fetch.js'

const index = buildSearchIndex([...parseGuides(GUIDES_TEXT), ...parseApiIndex(API_INDEX_TEXT)])

function titles(query: string, options: Parameters<typeof searchIndex>[2] = { limit: 5 }): string[] {
  return searchIndex(index, query, options).hits.map(hit => hit.entry.title)
}

describe('tokenize', () => {
  it('splits camelCase and paths, drops stopwords, and folds plurals', () => {
    expect(tokenize('How do I get /contacts/{contactId} categories?')).toEqual([
      'get',
      'contact',
      'contact',
      'id',
      'category'
    ])
  })

  it('normalizes path parameters for endpoint matching', () => {
    expect(normalizeApiPath('/Contacts/{contactId}/')).toBe('/contacts/{}')
    expect(normalizeApiPath('/contacts/:id')).toBe('/contacts/{}')
  })
})

describe('searchIndex', () => {
  it('ranks the section that answers a question first', () => {
    expect(titles('verify webhook signature')[0]).toBe('Billing Webhook › Signature verification')
    expect(titles('contact scopes')[0]).toBe('Scopes › Contact scopes')
  })

  it('puts an exact endpoint first whether or not the method is given', () => {
    expect(titles('GET /contacts/:contactId')[0]).toBe('Get Contact')
    expect(titles('/contacts/')[0]).toBe('Create Contact')
  })

  it('matches a concrete id against the documented path template', () => {
    expect(titles('GET /contacts/abc123')[0]).toBe('Get Contact')
  })

  it('ignores slashes that are not paths and boosts titles matching the whole question', () => {
    expect(searchIndex(index, 'create and/or update', { limit: 5 }).hits.every(hit => hit.score < 25)).toBe(true)
    const entries: DocEntry[] = ['Create Contact', 'Contact create rules'].map(title => ({
      kind: 'api',
      title,
      url: `https://marketplace.gohighlevel.com/docs/${title.replaceAll(' ', '-')}.md`,
      section: 'contacts',
      text: ''
    }))
    expect(searchIndex(buildSearchIndex(entries), 'how do I create a contact', { limit: 2 }).hits[0].entry.title).toBe(
      'Create Contact'
    )
  })

  it('ranks exact technical identifiers above documents that only share common words', () => {
    const entries: DocEntry[] = [
      { title: 'SDK › Webhook support', text: 'verify the webhook signature header with the public key in code' },
      { title: 'Guide › Ed25519 key', text: 'Use this key to verify the X-GHL-Signature header.' }
    ].map(({ title, text }) => ({
      kind: 'guide',
      title,
      url: `https://marketplace.gohighlevel.com/docs/${title.length}.md`,
      section: 'Webhooks',
      text
    }))
    const outcome = searchIndex(buildSearchIndex(entries), 'verify the X-GHL-Signature webhook header with code', {
      limit: 2
    })
    expect(outcome.hits[0].entry.title).toBe('Guide › Ed25519 key')
  })

  it('filters by kind and reports the number of matches before the limit', () => {
    expect(titles('contact', { limit: 5, kind: 'api' }).every(title => !title.includes('›'))).toBe(true)
    const outcome = searchIndex(index, 'contact', { limit: 1 })
    expect(outcome.hits).toHaveLength(1)
    expect(outcome.total).toBeGreaterThan(1)
  })

  it('limits how many sections of one page appear', () => {
    const entries: DocEntry[] = Array.from({ length: 4 }, (_, part) => ({
      kind: 'guide',
      title: `Page › token part ${part}`,
      url: `https://marketplace.gohighlevel.com/docs/page.md#part-${part}`,
      section: 'Guides',
      text: 'token refresh'
    }))
    const outcome = searchIndex(buildSearchIndex(entries), 'token refresh', { limit: 10 })
    expect(outcome.hits).toHaveLength(2)
    expect(outcome.total).toBe(4)
  })

  it('returns nothing for a query made only of stopwords', () => {
    expect(searchIndex(index, 'how do I', { limit: 5 })).toEqual({ hits: [], total: 0, terms: [] })
  })
})

describe('parseEndpointReference', () => {
  it('reads request lines, bare paths, and API URLs copied from code', () => {
    expect(parseEndpointReference('post /contacts/')).toEqual({ method: 'POST', path: '/contacts' })
    expect(parseEndpointReference(' /contacts/:id ')).toEqual({ path: '/contacts/{}' })
    expect(parseEndpointReference('GET https://services.leadconnectorhq.com/contacts/x?locationId=1')).toEqual({
      method: 'GET',
      path: '/contacts/x'
    })
  })

  it('leaves docs URLs and prose alone', () => {
    expect(parseEndpointReference('https://marketplace.gohighlevel.com/docs/oauth/Billing.md')).toBeUndefined()
    expect(parseEndpointReference('create a contact')).toBeUndefined()
    expect(parseEndpointReference('GET https://evil.example.com/contacts/')).toBeUndefined()
  })
})

describe('findEndpoints', () => {
  it('prefers exact paths, matches templates, and filters by method only when given', () => {
    const urls = (input: string) =>
      findEndpoints(index, parseEndpointReference(input) ?? { path: '' }).map(entry => entry.title)
    expect(urls('POST /contacts/')).toEqual(['Create Contact'])
    expect(urls('/contacts/abc')).toEqual(['Get Contact'])
    expect(urls('PUT /contacts/abc')).toEqual([])
    expect(urls('/calendars/events')).toEqual(['Get Calendar Events'])
  })
})
