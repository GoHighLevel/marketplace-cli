import { describe, expect, it } from 'vitest'

import { type BillingSubscriptionManifest, type BillingUsageManifest } from '../../../src/lib/billing/manifest.js'
import { validateBillingSubscriptionManifest, validateBillingUsageManifest } from '../../../src/lib/billing/schema.js'

function subscriptions(): BillingSubscriptionManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    plans: [
      {
        name: 'Pro',
        features: ['Automation'],
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

function usage(): BillingUsageManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    meters: [
      {
        productType: 'custom',
        productId: 'custom_contact_score',
        productName: 'Contact score',
        customPriceType: 'dynamic',
        usageUnit: 'score',
        pricingPageUrl: 'https://billing.example.com/contact-score',
        tiers: [
          {
            name: 'Scores',
            minVolume: 0,
            maxVolume: null,
            pricePerUnit: 0.02,
            minPricePerUnit: 0.01,
            maxPricePerUnit: 0.05,
            executionLimitPerCycle: 1000
          }
        ]
      }
    ]
  }
}

describe('subscription billing validation', () => {
  it('accepts portal-compatible plans down to one cent', () => {
    const manifest = subscriptions()
    manifest.plans[0].amount = 0.01
    expect(
      validateBillingSubscriptionManifest(manifest, {
        billingType: 'paid',
        status: 'draft',
        userTypes: ['company'],
        whiteLabel: false
      })
    ).toEqual([])
  })

  it('enforces plan caps, payment pairing, conditional prices, and white-label rules', () => {
    const manifest = subscriptions()
    manifest.plans = Array.from({ length: 7 }, (_, index) => ({
      ...manifest.plans[0],
      name: index === 0 ? 'GHL Pro' : `Plan ${index}`,
      paymentTime: 'life_time',
      paymentType: 'recurring',
      locationAmount: 5
    }))
    const errors = validateBillingSubscriptionManifest(manifest, {
      billingType: 'freemium',
      status: 'draft',
      userTypes: ['company'],
      whiteLabel: true
    })
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/at most 6/i),
        expect.stringMatching(/life_time.*one_time/i),
        expect.stringMatching(/sub-account pricing.*both/i),
        expect.stringMatching(/white-label/i)
      ])
    )
  })

  it('allows existing data on locked versions but rejects a requested mutation', () => {
    expect(
      validateBillingSubscriptionManifest(subscriptions(), {
        billingType: 'paid',
        status: 'live',
        userTypes: ['company'],
        whiteLabel: false
      })
    ).toEqual([])
    expect(
      validateBillingSubscriptionManifest(subscriptions(), {
        billingType: 'paid',
        status: 'live',
        userTypes: ['company'],
        whiteLabel: false,
        mutationRequested: true
      })
    ).toEqual(expect.arrayContaining([expect.stringMatching(/live.*draft or disapproved/i)]))
  })

  it('can structurally load portal state during a billing-model transition', () => {
    const manifest = subscriptions()
    manifest.plans[0] = {
      ...manifest.plans[0],
      name: 'Free',
      amount: 0,
      locationAmount: 0,
      freePlan: true,
      freeForAgency: true,
      freeForLocation: true
    }
    expect(
      validateBillingSubscriptionManifest(manifest, {
        billingType: 'paid',
        status: 'draft',
        userTypes: ['company'],
        whiteLabel: false,
        contextual: false
      })
    ).toEqual([])
    expect(
      validateBillingSubscriptionManifest(manifest, {
        billingType: 'paid',
        status: 'draft',
        userTypes: ['company'],
        whiteLabel: false
      })
    ).toEqual(expect.arrayContaining([expect.stringMatching(/freemium apps/i)]))
  })
})

describe('usage billing validation', () => {
  it('accepts dynamic custom pricing and public HTTPS pricing pages', () => {
    expect(validateBillingUsageManifest(usage(), { appType: 'standard', externalBilling: false })).toEqual([])
  })

  it('loads legacy dynamic portal meters structurally but rejects them for mutation', () => {
    const manifest = usage()
    delete manifest.meters[0].pricingPageUrl

    expect(
      validateBillingUsageManifest(manifest, {
        appType: 'standard',
        externalBilling: false,
        contextual: false
      })
    ).toEqual([])
    expect(
      validateBillingUsageManifest(manifest, {
        appType: 'standard',
        externalBilling: false
      })
    ).toEqual(expect.arrayContaining([expect.stringMatching(/pricingPageUrl is required/i)]))
  })

  it('validates product-specific fields, six-decimal prices, dynamic bounds, and tier overlap', () => {
    const manifest = usage()
    const meter = manifest.meters[0]
    meter.productType = 'workflow_action'
    meter.customPriceType = 'dynamic'
    meter.usageUnit = 'message'
    meter.tiers[0].pricePerUnit = 0.1234567
    meter.tiers[0].minPricePerUnit = 0.06
    meter.tiers[0].maxPricePerUnit = 0.05
    meter.tiers.push({
      name: 'Overlapping',
      minVolume: 0,
      maxVolume: 100,
      pricePerUnit: 0.01,
      executionLimitPerCycle: 100
    })
    const errors = validateBillingUsageManifest(manifest, {
      appType: 'standard',
      externalBilling: false,
      actionKeys: new Set(['another_action']),
      registeredActionKeys: new Set(['another_action'])
    })
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/workflow_action.*fixed/i),
        expect.stringMatching(/usageUnit.*execution/i),
        expect.stringMatching(/productId.*local workflow action/i),
        expect.stringMatching(/productId.*remotely registered workflow action/i),
        expect.stringMatching(/six decimal/i),
        expect.stringMatching(/minPricePerUnit.*less than/i),
        expect.stringMatching(/tiers.*overlap/i)
      ])
    )
  })

  it('rejects conversation-provider direction gaps and app types hidden by the UI', () => {
    const manifest = usage()
    manifest.meters[0] = {
      ...manifest.meters[0],
      productType: 'conversation_provider',
      productId: 'provider-1',
      customPriceType: 'fixed',
      usageUnit: 'message'
    }
    delete manifest.meters[0].direction
    const errors = validateBillingUsageManifest(manifest, {
      appType: 'template',
      externalBilling: true,
      mutationRequested: true
    })
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/direction.*required/i),
        expect.stringMatching(/external billing/i),
        expect.stringMatching(/template/i)
      ])
    )
  })

  it('bounds custom product identifiers before pattern validation', () => {
    const manifest = usage()
    manifest.meters[0].productId = `custom_${'a'.repeat(244)}`

    expect(
      validateBillingUsageManifest(manifest, {
        appType: 'standard',
        externalBilling: false
      })
    ).toEqual(expect.arrayContaining([expect.stringMatching(/productId must be at most 250 characters/i)]))
  })
})
