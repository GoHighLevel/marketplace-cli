import type { ApiClientConstructor } from '../core.js'
import { validateProfileUpdateResponse } from '../normalizers/app-version.js'
import { isRecord } from '../response.js'
import type { ClientKeyCreated, ProfileUpdateResult } from '../types.js'

export function withOAuth<TBase extends ApiClientConstructor>(Base: TBase) {
  return class extends Base {
    async updateAuthSettings(appId: string, versionId: string, body: unknown): Promise<ProfileUpdateResult> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/auth/${appId}/versions/${versionId}/settings`, {
        method: 'PUT',
        body
      })
      return validateProfileUpdateResponse(response, 'Auth settings update')
    }

    async makeRedirectUrlDefault(appId: string, versionId: string, redirectUrl: string): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/app/auth/${appId}/versions/${versionId}/redirectUrl/default`, {
        method: 'PUT',
        body: { redirectUrl }
      })
    }

    async addClientKey(appId: string, name: string): Promise<ClientKeyCreated> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/secrets/${appId}/clientKey`, {
        method: 'POST',
        body: { name }
      })
      const created = isRecord(response) && isRecord(response.clientKey) ? response.clientKey : response

      /* The secret is only ever returned here — if the response shape changed,
         fail loudly: a key without a captured secret is unusable. */
      if (
        !isRecord(created) ||
        typeof created.id !== 'string' ||
        !created.id ||
        typeof created.secret !== 'string' ||
        !created.secret
      ) {
        throw new Error(
          'Client key response did not include an id/secret. The key may still have been created — ' +
            'check `ghl app keys` and delete it, then retry.'
        )
      }
      return { id: created.id, secret: created.secret }
    }

    async deleteClientKey(appId: string, clientKeyId: string): Promise<void> {
      await this.ensureTeam()
      await this.request<unknown>(`/app/secrets/${appId}/clientKey/${clientKeyId}`, { method: 'DELETE' })
    }

    async makeClientKeyDefault(appId: string, clientKeyId: string): Promise<void> {
      await this.ensureTeam()
      await this.request<unknown>(`/app/secrets/${appId}/clientKey/${clientKeyId}/default`, { method: 'PUT', body: {} })
    }

    async generateSsoKey(appId: string): Promise<{ ssoKey: string }> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/secrets/${appId}/ssokey`, { method: 'POST', body: {} })
      if (!isRecord(response) || typeof response.ssoKey !== 'string' || !response.ssoKey) {
        throw new Error(
          'SSO key API returned an unexpected response. The key may have rotated; verify in the developer portal.'
        )
      }
      return { ssoKey: response.ssoKey }
    }
  }
}
