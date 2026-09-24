import type { ApiClientConstructor } from '../core.js'
import { normalizeUploadResponse } from '../normalizers/uploads.js'

export function withMedia<TBase extends ApiClientConstructor>(Base: TBase) {
  return class extends Base {
    /* File uploads go to the oauth service, matching the portal:
       POST /oauth/clients/:appId/files with `logo` or `preview` fields. */
    async uploadFiles(appId: string, form: FormData): Promise<Record<string, string>> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/files`, {
        method: 'POST',
        body: form,
        baseUrl: this.config.oauthUrl
      })
      return normalizeUploadResponse(response)
    }

    async deleteFiles(appId: string, fileUrls: string[]): Promise<void> {
      await this.ensureTeam()
      await this.request<unknown>(`/clients/${appId}/files`, {
        method: 'DELETE',
        body: { fileUrls },
        baseUrl: this.config.oauthUrl
      })
    }
  }
}
