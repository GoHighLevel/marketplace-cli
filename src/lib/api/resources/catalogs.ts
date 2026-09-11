import type { ApiClientConstructor } from '../core.js'
import { isRecord } from '../response.js'
import type { WebhooksCatalog } from '../types.js'

export function withCatalogs<TBase extends ApiClientConstructor>(Base: TBase) {
  return class extends Base {
    /* Scope and webhook-event catalogs live on the oauth service. */
    async getScopesCatalog(): Promise<unknown> {
      return this.request<unknown>('/static/scopes', {
        query: { isMarketplace: 'true' },
        baseUrl: this.config.oauthUrl
      })
    }

    async getWebhooksCatalog(): Promise<WebhooksCatalog> {
      const response = await this.request<unknown>('/static/webhooks', { baseUrl: this.config.oauthUrl })
      const events = isRecord(response) && Array.isArray(response.events) ? response.events : []
      const eventNames = new Set(events)
      if (
        !isRecord(response) ||
        !Array.isArray(response.events) ||
        !response.events.every(event => typeof event === 'string' && event.length > 0) ||
        eventNames.size !== response.events.length ||
        !isRecord(response.mapping) ||
        !Object.entries(response.mapping).every(
          ([scope, mappedEvents]) =>
            scope.length > 0 &&
            Array.isArray(mappedEvents) &&
            mappedEvents.every(event => typeof event === 'string' && eventNames.has(event)) &&
            new Set(mappedEvents).size === mappedEvents.length
        )
      ) {
        throw new Error('Webhook catalog API returned an unexpected response.')
      }
      return response as WebhooksCatalog
    }
  }
}
