import { describe, expect, it } from 'vitest'

import { type BillingSubscriptionManifest, type BillingUsageManifest } from '../../../src/lib/billing/manifest.js'
import { planBillingSubscriptionSync, planBillingUsageSync } from '../../../src/lib/billing/sync.js'

function subscriptions(name = 'Pro', feature = 'Automation'): BillingSubscriptionManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    plans: [
      {
        id: 'plan-1',
        name,
        features: [feature],
        paymentTime: 'month',
        paymentType: 'recurring',
        amount: 19.99,
        freePlan: false,
        freeForAgency: false,
        freeForLocation: false
      }
    ]
  }
}

function usage(name = 'Executions', limit = 1000): BillingUsageManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    meters: [
      {
        id: 'meter-1',
        productType: 'workflow_action',
        productId: 'send_message',
        productName: 'Send message',
        customPriceType: 'fixed',
        usageUnit: 'execution',
        tiers: [
          {
            id: 'tier-1',
            name,
            minVolume: 0,
            maxVolume: null,
            pricePerUnit: 0.01,
            executionLimitPerCycle: limit
          }
        ]
      }
    ]
  }
}

describe('subscription billing synchronization', () => {
  it('merges non-overlapping editable changes and detects same-field conflicts', () => {
    const merged = planBillingSubscriptionSync(subscriptions(), subscriptions('Local'), subscriptions('Pro', 'Portal'))
    expect(merged.conflicts).toEqual([])
    expect(merged.operations).toEqual([
      expect.objectContaining({
        type: 'update-plan',
        planId: 'plan-1',
        desired: expect.objectContaining({ name: 'Local', features: ['Portal'] })
      })
    ])

    const conflicted = planBillingSubscriptionSync(subscriptions(), subscriptions('Local'), subscriptions('Portal'))
    expect(conflicted.operations).toEqual([])
    expect(conflicted.conflicts).toContain('plans.plan-1.name')
  })

  it('rejects local edits to immutable prices and intervals', () => {
    const local = subscriptions()
    local.plans[0].amount = 29.99
    local.plans[0].paymentTime = 'year'
    const plan = planBillingSubscriptionSync(subscriptions(), local, subscriptions())
    expect(plan.operations).toEqual([])
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/amount.*immutable/i),
        expect.stringMatching(/paymentTime.*immutable/i)
      ])
    )
  })

  it('plans new plans and conflict-safe deletions', () => {
    const local = subscriptions()
    delete local.plans[0].id
    local.plans[0].name = 'Starter'
    const plan = planBillingSubscriptionSync(subscriptions(), local, subscriptions())
    expect(plan.operations.map(operation => operation.type)).toEqual(['delete-plan', 'create-plan'])
  })
})

describe('usage billing synchronization', () => {
  it('merges non-overlapping tier changes and rejects immutable meter identity changes', () => {
    const merged = planBillingUsageSync(usage(), usage('Local'), usage('Executions', 2000))
    expect(merged.operations).toEqual([
      expect.objectContaining({
        type: 'update-tier',
        meterId: 'meter-1',
        tierId: 'tier-1',
        desiredTier: expect.objectContaining({ name: 'Local', executionLimitPerCycle: 2000 })
      })
    ])

    const local = usage()
    local.meters[0].productId = 'renamed_action'
    const invalid = planBillingUsageSync(usage(), local, usage())
    expect(invalid.operations).toEqual([])
    expect(invalid.errors).toContain('meters.meter-1.productId is immutable; create a new meter instead.')
  })

  it('plans meter and tier lifecycle operations without replacing unchanged meters', () => {
    const base = usage()
    const local = usage()
    local.meters[0].tiers.push({
      name: 'Extra',
      minVolume: 1001,
      maxVolume: null,
      pricePerUnit: 0.005,
      executionLimitPerCycle: 2000
    })
    local.meters.push({
      productType: 'custom',
      productId: 'custom_export',
      productName: 'Export',
      customPriceType: 'fixed',
      usageUnit: 'export',
      tiers: [
        {
          name: 'Exports',
          minVolume: 0,
          maxVolume: null,
          pricePerUnit: 0.05,
          executionLimitPerCycle: 100
        }
      ]
    })
    const plan = planBillingUsageSync(base, local, base)
    expect(plan.operations.map(operation => operation.type)).toEqual(['create-tier', 'create-meter'])
  })

  it('deletes an existing product meter before creating its replacement', () => {
    const local = usage()
    local.meters = [
      {
        ...local.meters[0],
        id: undefined,
        productName: 'Replacement',
        tiers: local.meters[0].tiers.map(tier => ({ ...tier, id: undefined }))
      }
    ]
    const plan = planBillingUsageSync(usage(), local, usage())
    expect(plan.operations.map(operation => operation.type)).toEqual(['delete-meter', 'create-meter'])
  })
})
