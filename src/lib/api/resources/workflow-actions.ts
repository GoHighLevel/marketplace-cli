import type { ApiClientConstructor } from '../core.js'
import {
  isWorkflowActionSummary,
  recoverCreatedWorkflowVersion,
  workflowActionConfigs,
  workflowActionTestResponse
} from '../normalizers/workflows.js'
import { isRecord } from '../response.js'
import type {
  WorkflowActionConfig,
  WorkflowActionSummary,
  WorkflowActionTestRequest,
  WorkflowActionTestResponse
} from '../types.js'

export function withWorkflowActions<TBase extends ApiClientConstructor>(Base: TBase) {
  return class extends Base {
    async listWorkflowActionSummaries(appId: string): Promise<WorkflowActionSummary[]> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/actions`, { baseUrl: this.config.oauthUrl })
      if (!isRecord(response) || !Array.isArray(response.actions) || !response.actions.every(isWorkflowActionSummary)) {
        throw new Error('Workflow action registry API returned an unexpected response.')
      }
      return response.actions as WorkflowActionSummary[]
    }

    async listWorkflowActionConfigs(appId: string): Promise<WorkflowActionConfig[]> {
      await this.ensureTeam()
      const response = await this.request<unknown>('/actions', {
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId }
      })
      return workflowActionConfigs(response, 'Workflow action list')
    }

    async getWorkflowActionConfigs(
      appId: string,
      templateId: string,
      version?: string
    ): Promise<WorkflowActionConfig[]> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/actions/${templateId}`, {
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId },
        query: { version }
      })
      return workflowActionConfigs(response, 'Workflow action details')
    }

    async checkWorkflowActionKeyAvailability(appId: string, key: string): Promise<boolean> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/slugs/availability/${encodeURIComponent(key)}`, {
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId }
      })
      if (!isRecord(response) || typeof response.availability !== 'boolean') {
        throw new Error('Workflow action key availability API returned an unexpected response.')
      }
      return response.availability
    }

    async createWorkflowAction(
      appId: string,
      body: { name: string; key: string; version: string }
    ): Promise<WorkflowActionSummary> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/actions`, {
        method: 'POST',
        body,
        baseUrl: this.config.oauthUrl
      })
      if (!isRecord(response) || response.success !== true || !isWorkflowActionSummary(response.action)) {
        throw new Error(
          'Create workflow action API returned an unexpected response. The action may still have been created; run `ghl app actions pull`.'
        )
      }
      return response.action
    }

    async createWorkflowActionVersion(appId: string, templateId: string): Promise<WorkflowActionSummary> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/actions/${templateId}/new-version`, {
        method: 'POST',
        body: {},
        baseUrl: this.config.oauthUrl
      })
      if (isRecord(response) && response.success === true && isWorkflowActionSummary(response.action)) {
        return response.action
      }
      const recovered = await recoverCreatedWorkflowVersion(
        () => this.getWorkflowActionConfigs(appId, templateId),
        templateId,
        draft => ({
          _id: templateId,
          actionId: templateId,
          name: draft.info.name,
          version: draft.version,
          status: 'draft',
          isActive: false
        })
      )
      if (recovered) return recovered
      throw new Error(
        'Create workflow action version API returned an unexpected response. Run `ghl app actions pull` before retrying.'
      )
    }

    async updateWorkflowActionConfig(appId: string, templateId: string, body: unknown): Promise<void> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/actions/${templateId}`, {
        method: 'PUT',
        body,
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId }
      })
      if (!isRecord(response) || response.success !== true) {
        throw new Error(
          'Workflow action update API returned an unexpected response. Run `ghl app actions pull` before retrying.'
        )
      }
    }

    async updateWorkflowActionSummary(
      appId: string,
      templateId: string,
      body: { name?: string; version?: string; status?: string; isHidden?: boolean }
    ): Promise<WorkflowActionSummary> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/actions/${templateId}/update`, {
        method: 'POST',
        body,
        baseUrl: this.config.oauthUrl
      })
      if (!isRecord(response) || response.success !== true || !isWorkflowActionSummary(response.action)) {
        throw new Error(
          'Workflow action registry update API returned an unexpected response. Run `ghl app actions pull`.'
        )
      }
      return response.action
    }

    async deleteWorkflowAction(appId: string, templateId: string): Promise<void> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/actions/${templateId}`, {
        method: 'DELETE',
        baseUrl: this.config.oauthUrl
      })
      if (!isRecord(response) || response.success !== true) {
        throw new Error(
          'Delete workflow action API returned an unexpected response. Run `ghl app actions pull` to verify its state.'
        )
      }
    }

    async submitWorkflowActionForReview(
      appId: string,
      body: { id: string; type: 'Action'; version: string; releaseNotes: { user: string; reviewer: string } }
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
          'Workflow action review API returned an unexpected response. Run `ghl app actions pull` to verify its state.'
        )
      }
    }

    async publishWorkflowActionSummary(appId: string, templateId: string, version: string): Promise<void> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/clients/${appId}/actions/${templateId}/publish`, {
        method: 'POST',
        body: { version },
        baseUrl: this.config.oauthUrl
      })
      if (!isRecord(response) || response.success !== true) {
        throw new Error(
          'Workflow action publish registry API returned an unexpected response. Run `ghl app actions pull`.'
        )
      }
    }

    async testWorkflowAction(appId: string, body: WorkflowActionTestRequest): Promise<WorkflowActionTestResponse> {
      await this.ensureTeam()
      const response = await this.request<unknown>('/run-code-test', {
        method: 'POST',
        body,
        baseUrl: this.config.workflowsUrl,
        headers: { appid: appId }
      })
      return workflowActionTestResponse(response)
    }
  }
}
