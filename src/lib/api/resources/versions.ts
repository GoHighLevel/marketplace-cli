import type { ApiClientConstructor } from '../core.js'
import { normalizeAppVersion, validateProfileUpdateResponse } from '../normalizers/app-version.js'
import { hasOptionalStringFields } from '../normalizers/fields.js'
import { isRecord } from '../response.js'
import type {
  AppVersion,
  PreSubmitValidation,
  ProfileUpdateResult,
  VersionAnalysis,
  VersionListItem
} from '../types.js'

export function withVersions<TBase extends ApiClientConstructor>(Base: TBase) {
  return class extends Base {
    async getVersion(appId: string, versionId: string): Promise<AppVersion> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/${appId}/versions/${versionId}`)
      const version = normalizeAppVersion(response)
      if (!version) throw new Error('App version API returned an unexpected response.')
      return version
    }

    async getLatestVersion(appId: string, live = false): Promise<AppVersion> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/${appId}/versions/latest`, {
        query: { isLive: live ? 'true' : undefined }
      })
      const version = normalizeAppVersion(response)
      if (!version) throw new Error('Latest app version API returned an unexpected response.')
      return version
    }

    async preSubmitValidation(appId: string, versionId: string): Promise<PreSubmitValidation> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/${appId}/${versionId}/pre-submit-validation`)
      if (
        !isRecord(response) ||
        typeof response.success !== 'boolean' ||
        (response.message !== undefined && typeof response.message !== 'string') ||
        (response.mandatoryFields !== undefined &&
          (!isRecord(response.mandatoryFields) ||
            !Object.values(response.mandatoryFields).every(value => typeof value === 'boolean')))
      ) {
        throw new Error('Pre-submit validation API returned an unexpected response.')
      }
      return response as unknown as PreSubmitValidation
    }

    async updateProfileSection(
      section: 'basicInfo' | 'listingConfiguration' | 'appProfiles' | 'supportDetails',
      appId: string,
      versionId: string,
      body: unknown
    ): Promise<ProfileUpdateResult> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/profile/${appId}/versions/${versionId}/${section}`, {
        method: 'PUT',
        body
      })
      return validateProfileUpdateResponse(response, 'Profile update')
    }

    /* App-review details (demo URLs, test credentials) required before a
       public app can be submitted for marketplace review. */
    async updateReviewDetails(appId: string, versionId: string, body: unknown): Promise<ProfileUpdateResult> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/profile/${appId}/versions/${versionId}/additionalInfo`, {
        method: 'PATCH',
        body
      })
      return validateProfileUpdateResponse(response, 'Review details update')
    }

    async listVersions(appId: string): Promise<VersionListItem[]> {
      await this.ensureTeam()
      const response = await this.request<unknown>('/app/versions', { query: { appId } })
      if (
        !Array.isArray(response) ||
        !response.every(
          item =>
            isRecord(item) &&
            typeof item._id === 'string' &&
            item._id.length > 0 &&
            hasOptionalStringFields(item, ['appId', 'name', 'version', 'status'])
        )
      ) {
        throw new Error('App versions API returned an unexpected response.')
      }
      return response as VersionListItem[]
    }

    async analyzeVersion(appId: string, versionId: string): Promise<VersionAnalysis> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/${appId}/versions/${versionId}/analyze`)
      if (
        !isRecord(response) ||
        !hasOptionalStringFields(response, ['suggestedVersion', 'latestLiveVersion', 'updateType'], true)
      ) {
        throw new Error('Version analysis API returned an unexpected response.')
      }
      return response as VersionAnalysis
    }

    async publishVersion(
      appId: string,
      versionId: string,
      body: { newVersion: string; agencyNotes: string; subAccountNotes?: string }
    ): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/app/${appId}/versions/${versionId}/publish`, { method: 'POST', body })
    }

    async withdrawReview(appId: string, versionId: string): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/app/${appId}/versions/${versionId}/withdrawReview`, { method: 'POST', body: {} })
    }

    async cloneAsDraft(appId: string, versionId: string): Promise<{ id: string }> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/app/${appId}/versions/${versionId}/cloneAsDraft`, {
        method: 'POST',
        body: {}
      })
      if (
        !isRecord(response) ||
        !hasOptionalStringFields(response, ['_id', 'id']) ||
        ![response._id, response.id].some(id => typeof id === 'string' && id.length > 0)
      ) {
        throw new Error('Draft creation API returned an unexpected response. Run `ghl app versions` before retrying.')
      }
      return { id: typeof response._id === 'string' && response._id ? response._id : (response.id as string) }
    }

    async scheduleDeprecation(
      appId: string,
      versionId: string,
      body: { deprecateDate: string; timezone?: string; deprecationNotes: string }
    ): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/app/${appId}/versions/${versionId}/scheduleDeprecation`, { method: 'POST', body })
    }

    async requestSecurityReview(appId: string): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/app/${appId}/securityReview`, { method: 'POST', body: {} })
    }
  }
}
