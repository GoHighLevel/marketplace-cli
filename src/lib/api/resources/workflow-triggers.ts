import type { ApiClientConstructor } from '../core.js'
import {
  isWorkflowTriggerSummary,
  recoverCreatedWorkflowVersion,
  workflowTriggerConfigs
} from '../normalizers/workflows.js'
import { isRecord } from '../response.js'
import type { WorkflowTriggerConfig, WorkflowTriggerSummary } from '../types.js'

export function withWorkflowTriggers<TBase extends ApiClientConstructor>(Base: TBase) {
  return class extends Base {
    async listWorkflowTriggerSummaries(appId: string): Promise<WorkflowTriggerSummary[]> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/triggers`, { baseUrl: this.config.oauthUrl })
      if (
        !isRecord(response) ||
        !Array.isArray(response.triggers) ||
        !response.triggers.every(isWorkflowTriggerSummary)
      ) {
        throw new Error('Workflow trigger registry API returned an unexpected response.')
      }
      return response.triggers as WorkflowTriggerSummary[]
    }

    async listWorkflowTriggerConfigs(appId: string): Promise<WorkflowTriggerConfig[]> {
      await this.ensureTeam()
      const response = await this.request<unknown>('/triggers', {
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId }
      })
      return workflowTriggerConfigs(response, 'Workflow trigger list')
    }

    async getWorkflowTriggerConfigs(
      appId: string,
      templateId: string,
      version?: string
    ): Promise<WorkflowTriggerConfig[]> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/triggers/${templateId}`, {
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId },
        query: { version }
      })
      return workflowTriggerConfigs(response, 'Workflow trigger details')
    }

    async checkWorkflowTriggerKeyAvailability(appId: string, key: string): Promise<boolean> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/slugs/availability/${encodeURIComponent(key)}`, {
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId }
      })
      if (!isRecord(response) || typeof response.availability !== 'boolean') {
        throw new Error('Workflow trigger key availability API returned an unexpected response.')
      }
      return response.availability
    }

    async createWorkflowTrigger(
      appId: string,
      body: { name: string; key: string; version: string }
    ): Promise<WorkflowTriggerSummary> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/triggers`, {
        method: 'POST',
        body,
        baseUrl: this.config.oauthUrl
      })
      if (
        !isRecord(response) ||
        response.success !== true ||
        !isRecord(response.trigger) ||
        !isWorkflowTriggerSummary(response.trigger)
      ) {
        throw new Error(
          'Create workflow trigger API returned an unexpected response. The trigger may still have been created; run `ghl app triggers pull`.'
        )
      }
      return response.trigger
    }

    async createWorkflowTriggerVersion(appId: string, templateId: string): Promise<WorkflowTriggerSummary> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/triggers/${templateId}/new-version`, {
        method: 'POST',
        body: {},
        baseUrl: this.config.oauthUrl
      })
      if (
        isRecord(response) &&
        response.success === true &&
        isRecord(response.trigger) &&
        isWorkflowTriggerSummary(response.trigger)
      ) {
        return response.trigger
      }
      const recovered = await recoverCreatedWorkflowVersion(
        () => this.getWorkflowTriggerConfigs(appId, templateId),
        templateId,
        draft => ({
          _id: templateId,
          triggerId: templateId,
          name: draft.info.name,
          version: draft.version,
          status: 'draft',
          isActive: false
        })
      )
      if (recovered) return recovered
      throw new Error(
        'Create workflow trigger version API returned an unexpected response. Run `ghl app triggers pull` before retrying.'
      )
    }

    async updateWorkflowTriggerConfig(appId: string, templateId: string, body: unknown): Promise<void> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/triggers/${templateId}`, {
        method: 'PUT',
        body,
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId }
      })
      if (!isRecord(response) || response.success !== true) {
        throw new Error(
          'Workflow trigger update API returned an unexpected response. Run `ghl app triggers pull` before retrying.'
        )
      }
    }

    async updateWorkflowTriggerSummary(
      appId: string,
      templateId: string,
      body: { name?: string; version?: string; status?: string }
    ): Promise<WorkflowTriggerSummary> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/triggers/${templateId}/update`, {
        method: 'POST',
        body,
        baseUrl: this.config.oauthUrl
      })
      if (
        !isRecord(response) ||
        response.success !== true ||
        !isRecord(response.trigger) ||
        !isWorkflowTriggerSummary(response.trigger)
      ) {
        throw new Error(
          'Workflow trigger registry update API returned an unexpected response. Run `ghl app triggers pull`.'
        )
      }
      return response.trigger
    }

    async deleteWorkflowTrigger(appId: string, templateId: string): Promise<void> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/triggers/${templateId}`, {
        method: 'DELETE',
        baseUrl: this.config.oauthUrl
      })
      if (!isRecord(response) || response.success !== true) {
        throw new Error(
          'Delete workflow trigger API returned an unexpected response. Run `ghl app triggers pull` to verify its state.'
        )
      }
    }

    async submitWorkflowTriggerForReview(
      appId: string,
      body: { id: string; type: 'Trigger'; version: string; releaseNotes: { user: string; reviewer: string } }
    ): Promise<void> {
      await this.ensureTeam()
      const response = await this.request<unknown>('/releases/submit-for-review', {
        method: 'POST',
        body,
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId }
      })
      if (!isRecord(response) || response.success !== true) {
        throw new Error(
          'Workflow trigger review API returned an unexpected response. Run `ghl app triggers pull` to verify its state.'
        )
      }
    }

    async publishWorkflowTriggerSummary(appId: string, templateId: string, version: string): Promise<void> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/triggers/${templateId}/publish`, {
        method: 'POST',
        body: { version },
        baseUrl: this.config.oauthUrl
      })
      if (!isRecord(response) || response.success !== true) {
        throw new Error(
          'Workflow trigger publish registry API returned an unexpected response. Run `ghl app triggers pull`.'
        )
      }
    }
  }
}
