import { type WebhooksCatalog } from '../api/client.js'
import { eventsAllowedByScopes, scopeNamesFromCatalog } from '../auth/settings.js'
import { type AppSyncPlan } from './sync.js'

export interface AuthCatalogClient {
  getScopesCatalog(): Promise<unknown>
  getWebhooksCatalog(): Promise<WebhooksCatalog>
}

export interface AuthCatalogSnapshot {
  scopes?: unknown
  webhooks?: WebhooksCatalog
}

export async function validateDynamicAuthConfiguration(
  client: AuthCatalogClient,
  plan: AppSyncPlan,
  catalogs: AuthCatalogSnapshot = {}
): Promise<string[]> {
  const scopeChanged = plan.localChanges.some(change => change.path === 'oauth.allowedScopes')
  const eventsChanged = plan.localChanges.some(change => change.path.startsWith('webhooks.subscribedEvents.'))
  if (!scopeChanged && !eventsChanged) return []

  const errors: string[] = []
  const scopes = plan.desired.app.oauth.allowedScopes
  if (scopeChanged) {
    const catalog = catalogs.scopes ?? (await client.getScopesCatalog())
    const available = new Set(scopeNamesFromCatalog(catalog, plan.desired.app.listing.userTypes))
    const invalidScopes = scopes.filter(scope => !available.has(scope))
    if (invalidScopes.length > 0) {
      errors.push(`OAuth scopes are unknown or unavailable for this app target: ${invalidScopes.join(', ')}.`)
    }
  }

  const webhookCatalog = catalogs.webhooks ?? (await client.getWebhooksCatalog())
  const catalogEvents = new Set(webhookCatalog.events ?? [])
  const allowedEvents = new Set(eventsAllowedByScopes(scopes, webhookCatalog))
  const invalidEvents = plan.desired.webhooks.subscribedEvents
    .map(event => event.name)
    .filter(event => !catalogEvents.has(event) || !allowedEvents.has(event))
  if (invalidEvents.length > 0) {
    errors.push(`Webhook events are not available for the configured OAuth scopes: ${invalidEvents.join(', ')}.`)
  }
  return errors
}
