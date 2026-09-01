import { describe, expect, it } from 'vitest'

import {
  buildBillingPlan,
  buildBillingSettings,
  defaultFreePlan,
  isFreePlanEntry,
  parseAmount,
  requirePricingEditable
} from '../../../src/lib/billing/pricing.js'

describe('billing settings', () => {
  it('enforces external URLs and the portal trial-day range', () => {
    expect(() => buildBillingSettings({ model: 'paid', externalBillingUrl: 'billing.example.com' })).toThrow(/https/i)
    expect(() => buildBillingSettings({ model: 'paid', trialDays: 0 })).toThrow(/between 1 and 90/i)
    expect(() => buildBillingSettings({ model: 'free', trialDays: 14 })).toThrow(/paid or freemium/i)
    expect(() =>
      buildBillingSettings({ model: 'freemium', externalBillingUrl: 'https://billing.example.com' })
    ).toThrow(/paid apps/i)
    expect(buildBillingSettings({ model: 'paid', trialDays: 14 })).toMatchObject({
      billingType: 'paid',
      hasFreeTrial: true,
      freeTrialDuration: 14
    })
  })

  it('stores the external billing URL without a scheme, like the portal', () => {
    expect(buildBillingSettings({ model: 'paid', externalBillingUrl: 'https://billing.example.com/checkout' })).toMatchObject({
      externalBilling: true,
      externalBillingUrl: 'billing.example.com/checkout'
    })
  })

  it('applies the portal template-app restrictions', () => {
    expect(() => buildBillingSettings({ model: 'freemium', isTemplateApp: true })).toThrow(/template/i)
    expect(() => buildBillingSettings({ model: 'paid', trialDays: 14, isTemplateApp: true })).toThrow(/template/i)
    expect(() =>
      buildBillingSettings({ model: 'paid', externalBillingUrl: 'https://x.example.com', isTemplateApp: true })
    ).toThrow(/template/i)
  })

  it('matches the portal cutoff for external billing eligibility', () => {
    expect(() => buildBillingSettings({
      model: 'paid',
      externalBillingUrl: 'https://billing.example.com',
      createdAt: '2026-06-18T00:00:00.000Z'
    })).toThrow(/after June 17, 2026/i)
    expect(buildBillingSettings({
      model: 'paid',
      externalBillingUrl: 'https://billing.example.com',
      createdAt: '2026-06-17T00:00:00.000Z'
    }).externalBilling).toBe(true)
  })

  it('locks pricing edits for the statuses the portal disables', () => {
    for (const status of ['review', 'inReview', 'in-review', 'LIVE', 'deprecated']) {
      expect(() => requirePricingEditable(status)).toThrow(/draft or disapproved/i)
    }
    expect(() => requirePricingEditable('draft')).not.toThrow()
    expect(() => requirePricingEditable('disapproved')).not.toThrow()
  })
})

describe('billing plans', () => {
  it('parses positive currency amounts with up to two decimal places', () => {
    expect(parseAmount('49.99', 'Amount')).toBe(49.99)
    expect(() => parseAmount('49.999', 'Amount')).toThrow(/valid amount/i)
    expect(() => parseAmount('-1', 'Amount')).toThrow(/valid amount/i)
  })

  it('requires a name and positive paid amounts', () => {
    expect(() => buildBillingPlan({ name: ' ', free: true, interval: 'month' })).toThrow(/name is required/i)
    expect(() => buildBillingPlan({ name: 'Pro', free: false, amount: 0, interval: 'month' })).toThrow(/at least 0\.01/i)
    expect(() => buildBillingPlan({ name: 'Micro', free: false, amount: 0.01, interval: 'month' })).not.toThrow()
    expect(
      buildBillingPlan({
        name: 'Pro',
        free: false,
        amount: 49,
        locationAmount: 29,
        interval: 'month',
        features: ['Automation', 'Analytics']
      })
    ).toMatchObject({ amount: 49, locationAmount: 29, paymentType: 'recurring', features: ['Automation', 'Analytics'] })
    expect(buildBillingPlan({ name: 'Agency only', free: false, amount: 49, interval: 'month' })).not.toHaveProperty(
      'locationAmount'
    )
    expect(() =>
      buildBillingPlan({
        name: 'Pro',
        free: false,
        amount: 49,
        interval: 'month',
        features: ['1', '2', '3', '4', '5', '6']
      })
    ).toThrow(/at most 5/i)

    expect(
      buildBillingPlan({
        name: 'Pro',
        free: false,
        amount: 49,
        interval: 'month',
        features: ['Automation', 'Automation']
      }).features
    ).toEqual(['Automation', 'Automation'])
  })

  it('rejects paid amounts on a free plan and maps lifetime billing', () => {
    expect(() => buildBillingPlan({ name: 'Free', free: true, amount: 10, interval: 'month' })).toThrow(/--free/i)
    expect(buildBillingPlan({ name: 'Lifetime', free: false, amount: 99, interval: 'life_time' })).toMatchObject({
      paymentType: 'one_time'
    })
  })

  it('mirrors portal plan rules: freemium-only free plans, template intervals, location pricing gate', () => {
    expect(() => buildBillingPlan({ name: 'Free', free: true, interval: 'month', model: 'paid' })).toThrow(/freemium/i)
    expect(() => buildBillingPlan({ name: 'Free', free: true, interval: 'month', model: 'freemium' })).not.toThrow()
    expect(() =>
      buildBillingPlan({ name: 'Pro', free: false, amount: 9, interval: 'month', isTemplateApp: true })
    ).toThrow(/one-time/i)
    expect(() =>
      buildBillingPlan({ name: 'Pro', free: false, amount: 9, locationAmount: 5, interval: 'month', allowLocationPricing: false })
    ).toThrow(/both agencies and sub-accounts/i)
  })

  it('blocks GHL brand mentions in plans for white-label friendly apps', () => {
    expect(() =>
      buildBillingPlan({ name: 'GHL Pro', free: false, amount: 9, interval: 'month', isWhiteLabelFriendly: true })
    ).toThrow(/white-label/i)
    expect(() =>
      buildBillingPlan({
        name: 'Pro',
        free: false,
        amount: 9,
        interval: 'month',
        features: ['HighLevel sync'],
        isWhiteLabelFriendly: true
      })
    ).toThrow(/white-label/i)
    expect(() =>
      buildBillingPlan({ name: 'GHL Pro', free: false, amount: 9, interval: 'month', isWhiteLabelFriendly: false })
    ).not.toThrow()
  })

  it('builds the portal default free plan and detects free plan entries', () => {
    expect(defaultFreePlan(false)).toMatchObject({ name: 'Free Plan', freePlan: true, paymentTime: 'month' })
    expect(defaultFreePlan(true)).toMatchObject({ paymentTime: 'life_time', paymentType: 'one_time' })
    expect(isFreePlanEntry({ freePlan: true })).toBe(true)
    expect(isFreePlanEntry({ isFreemiumPlan: true })).toBe(true)
    expect(isFreePlanEntry({ freeForAgency: true, freeForLocation: true })).toBe(true)
    expect(isFreePlanEntry({ freeForAgency: true, freeForLocation: false })).toBe(false)
    expect(isFreePlanEntry({})).toBe(false)
  })
})
