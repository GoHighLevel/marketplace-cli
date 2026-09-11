import type { ApiClientConstructor } from '../core.js'
import { hasOptionalStringFields } from '../normalizers/fields.js'
import { isRecord } from '../response.js'
import type { AppListResponse, CreateAppRequestBody, CreatedApp } from '../types.js'

export function withApps<TBase extends ApiClientConstructor>(Base: TBase) {
  return class extends Base {
    async listApps(options: { skip?: number; limit?: number; search?: string }): Promise<AppListResponse> {
      await this.ensureTeam()
      const response = await this.request<unknown>('/app', {
        query: { skip: options.skip ?? 0, limit: options.limit ?? 50, nameSearch: options.search }
      })
      if (
        !isRecord(response) ||
        !Array.isArray(response.apps) ||
        typeof response.totalCount !== 'number' ||
        !Number.isInteger(response.totalCount) ||
        response.totalCount < 0 ||
        !response.apps.every(
          app =>
            isRecord(app) &&
            typeof app._id === 'string' &&
            app._id.length > 0 &&
            typeof app.name === 'string' &&
            app.name.trim().length > 0 &&
            hasOptionalStringFields(app, ['appId', 'status', 'version', 'createdAt']) &&
            (app.appId === undefined || (typeof app.appId === 'string' && app.appId.length > 0)) &&
            (app.private === undefined || typeof app.private === 'boolean') &&
            (app.isPending === undefined || typeof app.isPending === 'boolean') &&
            (app.agencyInstallCount === undefined ||
              (typeof app.agencyInstallCount === 'number' &&
                Number.isInteger(app.agencyInstallCount) &&
                app.agencyInstallCount >= 0))
        )
      ) {
        throw new Error('App list API returned an unexpected response.')
      }
      return response as unknown as AppListResponse
    }

    async createApp(body: CreateAppRequestBody): Promise<CreatedApp> {
      await this.ensureTeam()
      const response = await this.request<unknown>('/app', { method: 'POST', body })
      if (
        !isRecord(response) ||
        typeof response._id !== 'string' ||
        !response._id ||
        typeof response.name !== 'string' ||
        !response.name.trim() ||
        (response.appId !== undefined && (typeof response.appId !== 'string' || !response.appId))
      ) {
        throw new Error(
          'Create app API returned an unexpected response. The app may still have been created; run `ghl app list`.'
        )
      }
      return response as unknown as CreatedApp
    }
  }
}
