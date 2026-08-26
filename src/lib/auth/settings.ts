import { AppVersion, WebhooksCatalog } from '../api/client.js'
import { isRecord } from '../api/response.js'
import { validateHttpUrl, validateHttpsUrl } from '../shared/validation.js'

export interface AuthSettingsChanges {
  scopes?: string[]
  redirectUris?: string[]
  webhookUrl?: string
  subscribedEvents?: Array<{ name: string; url?: string }>
}

/* Auth and webhooks share one settings endpoint — always send the full
   object merged from current values, exactly like the portal pages do. */
export function buildAuthSettingsBody(version: AppVersion, changes: AuthSettingsChanges) {
  return {
    bypassDraft: false,
    scopes: changes.scopes ?? version.allowedScopes ?? [],
    redirectUris: changes.redirectUris ?? version.redirectUris ?? [],
    webhookUrl: changes.webhookUrl ?? version.webhookUrl ?? '',
    subscribedEvents: changes.subscribedEvents ?? version.subscribedEvents ?? []
  }
}

/* Validate the complete auth settings before saving. Add/setup commands require
   an OAuth pair; remove commands may intentionally clear the OAuth surface. */
export function requireAuthPrereqs(
  version: AppVersion,
  changes: AuthSettingsChanges,
  options: { allowEmpty?: boolean } = {}
): void {
  const scopes = changes.scopes ?? version.allowedScopes ?? []
  const redirectUris = changes.redirectUris ?? version.redirectUris ?? []
  if (scopes.some(scope => !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(scope))) {
    throw new Error('OAuth scope names must be 1-200 characters and contain only letters, numbers, dots, slashes, colons, underscores, or hyphens.')
  }
  if (new Set(scopes).size !== scopes.length) throw new Error('OAuth settings cannot contain duplicate scopes.')
  if (new Set(redirectUris).size !== redirectUris.length) {
    throw new Error('OAuth settings cannot contain duplicate redirect URIs.')
  }
  if (!options.allowEmpty && scopes.length === 0) {
    throw new Error(
      'Auth settings require at least one scope. Start with `ghl app scopes add <scope...> --redirect <url>`.'
    )
  }
  if (!options.allowEmpty && redirectUris.length === 0) {
    throw new Error(
      'Auth settings require at least one redirect URI. ' +
        'Include one in the first save: `ghl app scopes add <scope...> --redirect <url>`.'
    )
  }
  for (const redirectUri of redirectUris) {
    const result = validateHttpUrl(redirectUri, 'Redirect URI')
    if (result !== true) throw new Error(result)
  }

  const webhookUrl = changes.webhookUrl ?? version.webhookUrl ?? ''
  if (webhookUrl) {
    const result = validateHttpsUrl(webhookUrl, 'Webhook URL', { publicOnly: true })
    if (result !== true) throw new Error(result)
  }
  const events = changes.subscribedEvents ?? version.subscribedEvents ?? []
  if (new Set(events.map(event => event.name)).size !== events.length) {
    throw new Error('OAuth settings cannot contain duplicate webhook events.')
  }
  if (events.length > 0 && !webhookUrl) {
    throw new Error('Webhook subscriptions require a default webhook URL. Set one with `ghl app webhook url <url>`.')
  }
  for (const event of events) {
    if (!event.name.trim()) throw new Error('Webhook event names cannot be blank.')
    if (!/^[a-zA-Z][a-zA-Z0-9._:-]{0,199}$/.test(event.name)) {
      throw new Error('Webhook event names must use 1-200 letters, numbers, dots, colons, underscores, or hyphens.')
    }
    if (!event.url) continue
    const result = validateHttpsUrl(event.url, `Webhook URL for ${event.name}`, { publicOnly: true })
    if (result !== true) throw new Error(result)
  }
}

/* Removing a scope must also drop the webhook events that scope enables —
   the portal enforces this mapping on save. */
export function eventsAllowedByScopes(scopes: string[], catalog: WebhooksCatalog): string[] {
  const mapping = catalog.mapping ?? {}
  return scopes.flatMap(scope => mapping[scope] ?? [])
}

export function pruneEventsForScopes(
  events: Array<{ name: string; url?: string }>,
  scopes: string[],
  catalog: WebhooksCatalog
): Array<{ name: string; url?: string }> {
  const allowed = new Set(eventsAllowedByScopes(scopes, catalog))
  return events.filter(event => allowed.has(event.name))
}

export function mergeEventSubscriptions(
  current: Array<{ name: string; url?: string }>,
  names: string[],
  url?: string
): { events: Array<{ name: string; url?: string }>; added: number; updated: number } {
  const requested = new Set(names)
  let updated = 0
  const events = current.map(event => {
    if (!requested.has(event.name) || url === undefined || event.url === url) return event
    updated += 1
    return { ...event, url }
  })
  const existing = new Set(current.map(event => event.name))
  const addedEvents = names.filter(name => !existing.has(name)).map(name => ({ name, ...(url ? { url } : {}) }))
  return { events: [...events, ...addedEvents], added: addedEvents.length, updated }
}

export interface ScopeCatalogEntry {
  scope: string
  description?: string
  label?: string
  tokenType?: string[]
}

export function scopeCatalogEntries(catalog: unknown, userTypes: string[] = []): ScopeCatalogEntry[] {
  if (!Array.isArray(catalog)) throw new Error('OAuth scope catalog returned an unexpected response.')
  if (
    catalog.some(
      item =>
        !isRecord(item) ||
        typeof item.scope !== 'string' ||
        !item.scope ||
        (item.description !== undefined && typeof item.description !== 'string') ||
        (item.label !== undefined && typeof item.label !== 'string') ||
        (item.tokenType !== undefined &&
          (!Array.isArray(item.tokenType) || !item.tokenType.every(value => typeof value === 'string')))
    )
  ) {
    throw new Error('OAuth scope catalog returned an unexpected response.')
  }
  const scopes = catalog.map(item => (item as Record<string, unknown>).scope as string)
  if (new Set(scopes).size !== scopes.length) {
    throw new Error('OAuth scope catalog returned a duplicate scope.')
  }
  return (catalog as Record<string, unknown>[])
    .filter(item => {
      if (!Array.isArray(item.tokenType) || userTypes.length === 0) return true
      const tokenTypes = item.tokenType as string[]
      const companyOnly = tokenTypes.length > 0 && tokenTypes.every(type => type === 'Company')
      const locationOnly = tokenTypes.length > 0 && tokenTypes.every(type => type === 'Location')
      if (userTypes.includes('Location') && !userTypes.includes('Company') && companyOnly) return false
      if (userTypes.includes('Company') && !userTypes.includes('Location') && locationOnly) return false
      return true
    })
    .map(item => {
      return {
        scope: item.scope as string,
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
        ...(typeof item.label === 'string' ? { label: item.label } : {}),
        ...(Array.isArray(item.tokenType) ? { tokenType: item.tokenType as string[] } : {})
      }
    })
}

export function scopeNamesFromCatalog(catalog: unknown, userTypes: string[] = []): string[] {
  return scopeCatalogEntries(catalog, userTypes).map(entry => entry.scope)
}
