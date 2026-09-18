import type { ApiClientConstructor } from '../core.js'
import { isSandboxAccount } from '../normalizers/sandbox.js'
import { isRecord } from '../response.js'
import type { SandboxAccount, SandboxAccountsResponse } from '../types.js'

export function withSandbox<TBase extends ApiClientConstructor>(Base: TBase) {
  return class extends Base {
    /* Sandbox accounts are developer-scoped, not app-scoped: GET returns the
       accounts plus a companyId -> installed-app-names map. */
    async listSandboxAccounts(): Promise<SandboxAccountsResponse> {
      await this.ensureTeam()
      const response = await this.request<unknown>('/sandbox')
      if (
        !isRecord(response) ||
        !Array.isArray(response.accounts) ||
        !response.accounts.every(isSandboxAccount) ||
        !isRecord(response.apps ?? {}) ||
        !Object.values(response.apps ?? {}).every(
          appNames => Array.isArray(appNames) && appNames.every(name => typeof name === 'string')
        )
      ) {
        throw new Error('Sandbox API returned an unexpected response.')
      }
      return {
        accounts: response.accounts as SandboxAccount[],
        apps: (response.apps ?? {}) as Record<string, string[]>
      }
    }

    async createSandboxAccount(companyName: string, password: string): Promise<SandboxAccount> {
      await this.ensureTeam()
      const response = await this.request<unknown>('/sandbox', { method: 'POST', body: { companyName, password } })
      if (!isSandboxAccount(response)) {
        throw new Error('Sandbox creation returned an unexpected response.')
      }
      return response as SandboxAccount
    }

    /* Deletion is by the sandbox record _id (not companyId); the backend
       soft-deletes and cancels any pending renewal. */
    async deleteSandboxAccount(id: string): Promise<void> {
      await this.ensureTeam()
      await this.request<unknown>(`/sandbox/${id}`, { method: 'DELETE' })
    }
  }
}
