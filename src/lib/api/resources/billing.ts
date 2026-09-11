import type { ApiClientConstructor } from '../core.js'
import { isBillingPlan, isBillingUsageMeter } from '../normalizers/billing.js'
import type { BillingPlan, BillingSettings, BillingUsageMeter } from '../types.js'

export function withBilling<TBase extends ApiClientConstructor>(Base: TBase) {
  return class extends Base {
    async getBillingPlans(appId: string): Promise<BillingPlan[]> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/billing/clients/${appId}/plans`)
      if (!Array.isArray(response) || !response.every(isBillingPlan)) {
        throw new Error('Billing plans API returned an unexpected response.')
      }
      return response
    }

    async updateBillingSettings(appId: string, body: BillingSettings): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/billing/settings/${appId}`, { method: 'PUT', body })
    }

    async addBillingPlan(appId: string, body: unknown): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/billing/clients/${appId}/plans`, { method: 'POST', body })
    }

    async updateBillingPlan(appId: string, planId: string, body: unknown): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/billing/clients/${appId}/plans/${planId}`, { method: 'PUT', body })
    }

    async deleteBillingPlan(appId: string, planId: string): Promise<void> {
      await this.ensureTeam()
      await this.request<unknown>(`/billing/clients/${appId}/plans/${planId}`, { method: 'DELETE' })
    }

    /* Portal-parity helper: switching from freemium to paid drops every free
       plan in one call, matching the portal's confirm-and-delete-all flow. */
    async deleteAllFreePlans(appId: string): Promise<void> {
      await this.ensureTeam()
      await this.request<unknown>(`/billing/clients/${appId}/plans/free`, { method: 'DELETE' })
    }

    async getBillingUsageMeters(appId: string): Promise<BillingUsageMeter[]> {
      await this.ensureTeam()
      const response = await this.request<unknown>(`/billing/usage/${appId}/meter`)
      if (!Array.isArray(response) || !response.every(isBillingUsageMeter)) {
        throw new Error('Usage-based billing API returned an unexpected response.')
      }
      return response
    }

    async addBillingUsageMeter(appId: string, body: unknown): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/billing/usage/${appId}/meter`, { method: 'POST', body })
    }

    async updateBillingUsageTier(appId: string, meterId: string, tierId: string, body: unknown): Promise<unknown> {
      await this.ensureTeam()
      return this.request<unknown>(`/billing/usage/${appId}/meter/${meterId}/tier/${tierId}`, {
        method: 'PATCH',
        body
      })
    }

    async deleteBillingUsageMeter(appId: string, meterId: string): Promise<void> {
      await this.ensureTeam()
      await this.request<unknown>(`/billing/usage/${appId}/meter/${meterId}`, { method: 'DELETE' })
    }

    async deleteBillingUsageTier(appId: string, meterId: string, tierId: string): Promise<void> {
      await this.ensureTeam()
      await this.request<unknown>(`/billing/usage/${appId}/meter/${meterId}/tier/${tierId}`, { method: 'DELETE' })
    }
  }
}
