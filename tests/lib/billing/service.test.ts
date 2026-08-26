import { describe, expect, it, vi } from 'vitest'

import {
  BillingSubscriptionManifest,
  BillingUsageManifest
} from '../../../src/lib/billing/manifest.js'
import {
  executeBillingSyncPlans,
  fetchBillingSnapshot,
  reconcileBillingAfterPush,
  verifyBillingOperations
} from '../../../src/lib/billing/service.js'
import {
  planBillingSubscriptionSync,
  planBillingUsageSync
} from '../../../src/lib/billing/sync.js'

function subscriptions(name = 'Pro'): BillingSubscriptionManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    plans: [{
      id: 'plan-1',
      name,
      features: [],
      paymentTime: 'month',
      paymentType: 'recurring',
      amount: 10,
      freePlan: false,
      freeForAgency: false,
      freeForLocation: false
    }]
  }
}

function usage(name = 'Executions'): BillingUsageManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    meters: [{
      id: 'meter-1',
      productType: 'workflow_action',
      productId: 'send_message',
      productName: 'Send message',
      customPriceType: 'fixed',
      usageUnit: 'execution',
      tiers: [{
        id: 'tier-1',
        name,
        minVolume: 0,
        maxVolume: null,
        pricePerUnit: 0.01,
        executionLimitPerCycle: 100
      }]
    }]
  }
}

describe('billing API service', () => {
  it('fetches and maps subscription and usage resources together', async () => {
    const client = {
      getBillingPlans: vi.fn().mockResolvedValue([{
        _id: 'plan-1',
        name: 'Pro',
        features: [],
        price: 10,
        paymentTime: 'month',
        paymentType: 'recurring'
      }]),
      getBillingUsageMeters: vi.fn().mockResolvedValue([])
    }
    const snapshot = await fetchBillingSnapshot(client, 'app-1')
    expect(snapshot.subscriptions.plans[0]).toMatchObject({ id: 'plan-1', amount: 10 })
    expect(snapshot.usage.meters).toEqual([])
  })

  it('calls only the APIs represented by the sync plans', async () => {
    const subscriptionPlan = planBillingSubscriptionSync(subscriptions(), subscriptions('Local'), subscriptions())
    const usagePlan = planBillingUsageSync(usage(), usage('Local tier'), usage())
    const client = {
      addBillingPlan: vi.fn(),
      updateBillingPlan: vi.fn(),
      deleteBillingPlan: vi.fn(),
      addBillingUsageMeter: vi.fn(),
      updateBillingUsageTier: vi.fn(),
      deleteBillingUsageTier: vi.fn(),
      deleteBillingUsageMeter: vi.fn()
    }
    const result = await executeBillingSyncPlans(client, subscriptionPlan, usagePlan)
    expect(result).toMatchObject({ total: 2, succeeded: 2, failed: 0 })
    expect(client.updateBillingPlan).toHaveBeenCalledOnce()
    expect(client.updateBillingUsageTier).toHaveBeenCalledOnce()
    expect(client.addBillingPlan).not.toHaveBeenCalled()
    expect(client.addBillingUsageMeter).not.toHaveBeenCalled()
  })

  it('continues independent operations and reports API failures', async () => {
    const baseline = subscriptions()
    const local = subscriptions()
    local.plans = [
      ...local.plans,
      { ...local.plans[0], id: undefined, name: 'Starter' },
      { ...local.plans[0], id: undefined, name: 'Business' }
    ]
    const subscriptionPlan = planBillingSubscriptionSync(baseline, local, baseline)
    const client = {
      addBillingPlan: vi.fn()
        .mockRejectedValueOnce(new Error('Stripe is unavailable'))
        .mockResolvedValueOnce({ success: true }),
      updateBillingPlan: vi.fn(),
      deleteBillingPlan: vi.fn(),
      addBillingUsageMeter: vi.fn(),
      updateBillingUsageTier: vi.fn(),
      deleteBillingUsageTier: vi.fn(),
      deleteBillingUsageMeter: vi.fn()
    }
    const result = await executeBillingSyncPlans(
      client,
      subscriptionPlan,
      planBillingUsageSync(usage(), usage(), usage())
    )
    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 })
    expect(result.results[0]).toMatchObject({ success: false, error: 'Stripe is unavailable' })
    expect(client.addBillingPlan).toHaveBeenCalledTimes(2)
  })

  it('verifies applied updates and keeps failed local intent during reconciliation', () => {
    const subscriptionPlan = planBillingSubscriptionSync(subscriptions(), subscriptions('Local'), subscriptions())
    const usagePlan = planBillingUsageSync(usage(), usage('Local tier'), usage())
    expect(verifyBillingOperations(subscriptionPlan, usagePlan, {
      subscriptions: subscriptions('Local'),
      usage: usage('Local tier')
    })).toEqual([])

    const reconciled = reconcileBillingAfterPush(
      { subscriptions: subscriptions('Local'), usage: usage('Local tier') },
      { subscriptions: subscriptions(), usage: usage() },
      subscriptionPlan,
      usagePlan,
      new Set(['update-plan:plan-1', 'update-tier:meter-1:tier-1'])
    )
    expect(reconciled.subscriptions.plans[0].name).toBe('Local')
    expect(reconciled.usage.meters[0].tiers[0].name).toBe('Local tier')
  })
})
