import { describe, expect, it, vi } from 'vitest'

import { AppVersion } from '../../../src/lib/api/client.js'
import { executeAppSyncPlan, PushClient } from '../../../src/lib/app/push.js'
import { createAppSyncPlan } from '../../../src/lib/app/sync.js'
import { WorkspaceState } from '../../../src/lib/app/workspace.js'
import { cloneAppFiles, completeAppFiles, completeAppVersion } from '../../helpers/app-files.js'

function stateFor() {
  const baseline = completeAppFiles()
  return {
    baseline,
    state: {
      schemaVersion: 1,
      appId: baseline.app.appId,
      versionId: baseline.app.versionId,
      baseline: cloneAppFiles(baseline)
    } satisfies WorkspaceState
  }
}

function mockClient(): PushClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    updateProfileSection: vi.fn().mockResolvedValue({ oAuthClient: { _id: 'version-1', appId: 'app-1' } }),
    updateReviewDetails: vi.fn().mockResolvedValue({ oAuthClient: { _id: 'version-1', appId: 'app-1' } }),
    updateAuthSettings: vi.fn().mockResolvedValue({ pendingOAuthClient: { id: 'version-1', appId: 'app-1' } }),
    makeRedirectUrlDefault: vi.fn().mockResolvedValue({ success: true }),
    makeClientKeyDefault: vi.fn().mockResolvedValue(undefined),
    updateBillingSettings: vi.fn().mockResolvedValue({ updated: true })
  }
}

function expectOnlyCalled(client: Record<string, ReturnType<typeof vi.fn>>, names: string[]): void {
  for (const [name, method] of Object.entries(client)) {
    if (names.includes(name)) expect(method, name).toHaveBeenCalled()
    else expect(method, name).not.toHaveBeenCalled()
  }
}

describe('executeAppSyncPlan', () => {
  it('uses one auth API call for a webhook-only change', async () => {
    const { baseline, state } = stateFor()
    const local = cloneAppFiles(baseline)
    local.webhooks.subscribedEvents.find(event => event.name === 'ContactUpdate')!.url =
      'https://api.acme.example.com/contact-update-v2'
    const plan = createAppSyncPlan(local, state, cloneAppFiles(baseline))
    const client = mockClient()

    const result = await executeAppSyncPlan(client, completeAppVersion(), plan)

    expectOnlyCalled(client, ['updateAuthSettings'])
    expect(client.updateAuthSettings).toHaveBeenCalledWith('app-1', 'version-1', {
      bypassDraft: false,
      scopes: ['contacts.readonly'],
      redirectUris: ['https://acme.example.com/oauth/callback'],
      webhookUrl: 'https://api.acme.example.com/webhooks',
      subscribedEvents: [
        { name: 'ContactCreate' },
        { name: 'ContactUpdate', url: 'https://api.acme.example.com/contact-update-v2' }
      ]
    })
    expect(result).toEqual({ appliedSections: ['authSettings'], versionId: 'version-1' })
  })

  it('calls each changed section once and follows a newly created draft version', async () => {
    const { baseline, state } = stateFor()
    const local = cloneAppFiles(baseline)
    local.app.listing.searchKeywords = ['crm', 'automation']
    local.app.supportConfig.documentationUrl = 'https://developer.acme.example.com'
    const plan = createAppSyncPlan(local, state, cloneAppFiles(baseline))
    const client = mockClient()
    client.updateProfileSection
      .mockResolvedValueOnce({ oAuthClient: { _id: 'draft-2', appId: 'app-1' } })
      .mockResolvedValueOnce({ oAuthClient: { _id: 'draft-2', appId: 'app-1' } })

    const result = await executeAppSyncPlan(client, completeAppVersion(), plan)

    expectOnlyCalled(client, ['updateProfileSection'])
    expect(client.updateProfileSection).toHaveBeenNthCalledWith(
      1,
      'listingConfiguration',
      'app-1',
      'version-1',
      expect.objectContaining({ searchKeywords: ['automation', 'crm'] })
    )
    expect(client.updateProfileSection).toHaveBeenNthCalledWith(
      2,
      'supportDetails',
      'app-1',
      'draft-2',
      expect.objectContaining({
        supportConfig: expect.objectContaining({ documentationUrl: 'https://developer.acme.example.com' })
      })
    )
    expect(result).toEqual({ appliedSections: ['listing', 'support'], versionId: 'draft-2' })
  })

  it('maps basic info and both marketplace profiles to their full section payloads', async () => {
    const { baseline, state } = stateFor()
    const local = cloneAppFiles(baseline)
    local.app.basicInfo.name = 'Acme CRM Plus'
    local.app.profiles.agency.description = 'C'.repeat(320)
    local.app.profiles.subAccount.description = 'D'.repeat(320)
    const plan = createAppSyncPlan(local, state, cloneAppFiles(baseline))
    const client = mockClient()

    const result = await executeAppSyncPlan(client, completeAppVersion(), plan)

    expectOnlyCalled(client, ['updateProfileSection'])
    expect(client.updateProfileSection).toHaveBeenNthCalledWith(
      1,
      'basicInfo',
      'app-1',
      'version-1',
      expect.objectContaining({ name: 'Acme CRM Plus', category: '', private: false })
    )
    expect(client.updateProfileSection).toHaveBeenNthCalledWith(
      2,
      'appProfiles',
      'app-1',
      'version-1',
      expect.objectContaining({
        description: 'C'.repeat(320),
        subAccountDescription: 'D'.repeat(320),
        hasSubAccountProfile: true,
        private: false
      })
    )
    expect(result.appliedSections).toEqual(['basicInfo', 'profiles'])
  })

  it('maps default redirect and default client key to dedicated APIs only', async () => {
    const baseline = completeAppFiles({
      status: 'live',
      redirectUris: [
        'https://acme.example.com/oauth/callback',
        'https://acme.example.com/oauth/secondary'
      ],
      clientKeys: [
        { id: 'client-1', name: 'Production', isDefault: true },
        { id: 'client-2', name: 'Secondary', isDefault: false }
      ]
    })
    const state = {
      schemaVersion: 1 as const,
      appId: baseline.app.appId,
      versionId: baseline.app.versionId,
      baseline: cloneAppFiles(baseline)
    }
    const local = cloneAppFiles(baseline)
    local.app.oauth.defaults.redirectUrl = 'https://acme.example.com/oauth/secondary'
    local.app.oauth.defaults.clientKey = 'client-2'
    const remote = cloneAppFiles(baseline)
    const plan = createAppSyncPlan(local, state, remote)
    const client = mockClient()

    const result = await executeAppSyncPlan(
      client,
      completeAppVersion({
        status: 'live',
        redirectUris: local.app.oauth.redirectUris,
        clientKeys: local.app.oauth.clientKeys
      }),
      plan
    )

    expectOnlyCalled(client, ['makeRedirectUrlDefault', 'makeClientKeyDefault'])
    expect(client.makeRedirectUrlDefault).toHaveBeenCalledWith(
      'app-1',
      'version-1',
      'https://acme.example.com/oauth/secondary'
    )
    expect(client.makeClientKeyDefault).toHaveBeenCalledWith('app-1', 'client-2')
    expect(result.appliedSections).toEqual(['defaultRedirect', 'defaultClientKey'])
  })

  it('maps review and billing changes to dedicated APIs without sending review credentials', async () => {
    const { baseline, state } = stateFor()
    const local = cloneAppFiles(baseline)
    local.app.review.additionalDetails = 'Updated review notes'
    local.app.billing.billingType = 'paid'
    const plan = createAppSyncPlan(local, state, cloneAppFiles(baseline))
    const client = mockClient()

    const result = await executeAppSyncPlan(client, completeAppVersion({ testCredentials: 'server-only' }), plan)

    expectOnlyCalled(client, ['updateReviewDetails', 'updateBillingSettings'])
    expect(client.updateReviewDetails).toHaveBeenCalledWith(
      'app-1',
      'version-1',
      expect.not.objectContaining({ testCredentials: expect.anything() })
    )
    expect(client.updateBillingSettings).toHaveBeenCalledWith('app-1', {
      billingType: 'paid',
      externalBilling: false,
      externalBillingUrl: '',
      hasFreeTrial: false,
      freeTrialDuration: undefined
    })
    expect(result.appliedSections).toEqual(['review', 'billing'])
  })

  it('makes no mutation calls for a no-op plan', async () => {
    const { baseline, state } = stateFor()
    const plan = createAppSyncPlan(cloneAppFiles(baseline), state, cloneAppFiles(baseline))
    const client = mockClient()

    await expect(executeAppSyncPlan(client, completeAppVersion(), plan)).resolves.toEqual({
      appliedSections: [],
      versionId: 'version-1'
    })
    expectOnlyCalled(client, [])
  })

  it('reports partial application without attempting later sections after an API failure', async () => {
    const { baseline, state } = stateFor()
    const local = cloneAppFiles(baseline)
    local.app.basicInfo.name = 'Updated name'
    local.app.supportConfig.documentationUrl = 'https://developer.acme.example.com'
    const plan = createAppSyncPlan(local, state, cloneAppFiles(baseline))
    const client = mockClient()
    client.updateProfileSection
      .mockResolvedValueOnce({ oAuthClient: { _id: 'version-1', appId: 'app-1' } })
      .mockRejectedValueOnce(new Error('support rejected'))

    await expect(executeAppSyncPlan(client, completeAppVersion(), plan)).rejects.toThrow(
      /support rejected.*basicInfo.*pull/i
    )
    expect(client.updateProfileSection).toHaveBeenCalledTimes(2)
  })
})
