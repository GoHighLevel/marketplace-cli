import { describe, expect, it } from 'vitest'

import {
  buildAuthSettingsBody,
  eventsAllowedByScopes,
  mergeEventSubscriptions,
  pruneEventsForScopes,
  requireAuthPrereqs,
  scopeCatalogEntries,
  scopeNamesFromCatalog
} from '../../../src/lib/auth/settings.js'

const version = {
  _id: 'v1',
  allowedScopes: ['contacts.readonly'],
  redirectUris: ['https://a.com/cb'],
  webhookUrl: 'https://a.com/hooks',
  subscribedEvents: [{ name: 'ContactCreate' }]
}

const catalog = {
  mapping: {
    'contacts.readonly': ['ContactCreate', 'ContactUpdate'],
    'locations.readonly': ['LocationCreate']
  }
}

describe('buildAuthSettingsBody', () => {
  it('merges changes over current settings and always sends the full object', () => {
    const body = buildAuthSettingsBody(version, { scopes: ['contacts.readonly', 'locations.readonly'] })
    expect(body.scopes).toHaveLength(2)
    expect(body.redirectUris).toEqual(['https://a.com/cb'])
    expect(body.webhookUrl).toBe('https://a.com/hooks')
    expect(body.subscribedEvents).toEqual([{ name: 'ContactCreate' }])
    expect(body.bypassDraft).toBe(false)
  })
})

describe('requireAuthPrereqs', () => {
  it('validates final redirect and webhook targets before saving', () => {
    expect(() => requireAuthPrereqs(version, {})).not.toThrow()
    expect(() => requireAuthPrereqs(version, { redirectUris: ['not-a-url'] })).toThrow(/Redirect URI.*valid http/i)
    expect(() => requireAuthPrereqs(version, { webhookUrl: 'http://hooks.example.com' })).toThrow(/https/i)
    expect(() =>
      requireAuthPrereqs(version, { subscribedEvents: [{ name: 'ContactCreate', url: 'https://127.0.0.1' }] })
    ).toThrow(/public/i)
    expect(() =>
      requireAuthPrereqs(
        { ...version, webhookUrl: '' },
        { subscribedEvents: [{ name: 'ContactCreate', url: 'https://hooks.example.com/contact' }] }
      )
    ).toThrow(/default webhook URL/i)
  })

  it('allows remove commands to intentionally clear OAuth settings', () => {
    expect(() => requireAuthPrereqs(version, { scopes: [], redirectUris: [] }, { allowEmpty: true })).not.toThrow()
    expect(() => requireAuthPrereqs(version, { scopes: [], redirectUris: [] })).toThrow(/at least one scope/i)
  })

  it('rejects duplicate OAuth settings before sending an ambiguous payload', () => {
    expect(() => requireAuthPrereqs(version, { scopes: ['contacts.readonly', 'contacts.readonly'] })).toThrow(
      /duplicate scopes/i
    )
    expect(() => requireAuthPrereqs(version, { redirectUris: ['https://a.com/cb', 'https://a.com/cb'] })).toThrow(
      /duplicate redirect/i
    )
    expect(() =>
      requireAuthPrereqs(version, {
        subscribedEvents: [{ name: 'ContactCreate' }, { name: 'ContactCreate', url: 'https://a.com/hook' }]
      })
    ).toThrow(/duplicate webhook/i)
  })
})

describe('eventsAllowedByScopes', () => {
  it('collects events from the scope mapping', () => {
    expect(eventsAllowedByScopes(['contacts.readonly'], catalog)).toEqual(['ContactCreate', 'ContactUpdate'])
    expect(eventsAllowedByScopes(['unknown.scope'], catalog)).toEqual([])
  })
})

describe('mergeEventSubscriptions', () => {
  it('adds new events and updates the override URL of existing events', () => {
    expect(
      mergeEventSubscriptions([{ name: 'ContactCreate' }], ['ContactCreate', 'ContactUpdate'], 'https://hooks.test')
    ).toEqual({
      events: [
        { name: 'ContactCreate', url: 'https://hooks.test' },
        { name: 'ContactUpdate', url: 'https://hooks.test' }
      ],
      added: 1,
      updated: 1
    })
  })
})

describe('pruneEventsForScopes', () => {
  it('drops subscribed events whose scope was removed', () => {
    const events = [{ name: 'ContactCreate' }, { name: 'LocationCreate' }]
    expect(pruneEventsForScopes(events, ['contacts.readonly'], catalog)).toEqual([{ name: 'ContactCreate' }])
  })
})

describe('scopeNamesFromCatalog', () => {
  it('extracts scope names and fails on an unexpected catalog shape', () => {
    expect(scopeNamesFromCatalog([{ scope: 'contacts.readonly' }, { scope: 'locations.readonly' }])).toEqual([
      'contacts.readonly',
      'locations.readonly'
    ])
    expect(
      scopeNamesFromCatalog(
        [
          { scope: 'agencies.readonly', tokenType: ['Company'] },
          { scope: 'contacts.readonly', tokenType: ['Location'] }
        ],
        ['Company']
      )
    ).toEqual(['agencies.readonly'])
    expect(() => scopeNamesFromCatalog({ scopes: [] })).toThrow(/scope catalog/i)
  })
})

describe('scopeCatalogEntries', () => {
  it('preserves descriptions for CLI discovery', () => {
    expect(scopeCatalogEntries([{ scope: 'contacts.readonly', description: 'Read contacts' }])).toEqual([
      { scope: 'contacts.readonly', description: 'Read contacts' }
    ])
    expect(() => scopeCatalogEntries([{ scope: 'contacts.readonly', tokenType: 'Location' }])).toThrow(/scope catalog/i)
    expect(() => scopeCatalogEntries([{ scope: 'contacts.readonly' }, { scope: 'contacts.readonly' }])).toThrow(
      /duplicate scope/i
    )
  })
})
