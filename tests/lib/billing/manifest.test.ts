import { describe, expect, it } from 'vitest'

import {
  buildBillingSubscriptionManifest,
  buildBillingUsageManifest,
  createBillingMeterScaffold,
  createBillingPlanScaffold,
  toBillingMeterCreateBody,
  toBillingMeterUpdateBody,
  toBillingPlanCreateBody
} from '../../../src/lib/billing/manifest.js'

describe('billing manifests', () => {
  it('maps subscription API fields without billing-provider identifiers', () => {
    expect(buildBillingSubscriptionManifest('app-1', [{
      _id: 'plan-1',
      name: 'Pro',
      features: ['Automation'],
      price: 29.99,
      locationPrice: 19.99,
      paymentTime: 'month',
      paymentType: 'recurring',
      isFreemiumPlan: false,
      freeForAgency: false,
      freeForLocation: false
    }])).toEqual({
      schemaVersion: 1,
      appId: 'app-1',
      plans: [{
        id: 'plan-1',
        name: 'Pro',
        features: ['Automation'],
        paymentTime: 'month',
        paymentType: 'recurring',
        amount: 29.99,
        locationAmount: 19.99,
        freePlan: false,
        freeForAgency: false,
        freeForLocation: false
      }]
    })
  })

  it('maps every meter tier and normalizes an unlimited maximum to null', () => {
    expect(buildBillingUsageManifest('app-1', [{
      _id: 'meter-1',
      appId: 'app-1',
      productType: 'workflow_action',
      productId: 'send_message',
      productName: 'Send message',
      customPriceType: 'fixed',
      usageUnit: 'execution',
      billingTier: [{
        _id: 'tier-1',
        name: 'Standard',
        minVolume: 0,
        maxVolume: null,
        pricePerUnit: 0.01,
        executionLimitPerCycle: 1000
      }]
    }])).toEqual({
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
          name: 'Standard',
          minVolume: 0,
          maxVolume: null,
          pricePerUnit: 0.01,
          executionLimitPerCycle: 1000
        }]
      }]
    })
  })

  it('creates local scaffolds and exact API request bodies', () => {
    const plan = createBillingPlanScaffold({ name: 'Pro', amount: 9.99, paymentTime: 'month' })
    expect(plan).toMatchObject({ paymentType: 'recurring', freePlan: false, features: [] })
    expect(toBillingPlanCreateBody(plan)).toEqual(plan)

    const meter = createBillingMeterScaffold({
      productType: 'workflow_trigger',
      productId: 'contact_scored',
      productName: 'Contact scored',
      name: 'Trigger executions',
      pricePerUnit: 0.002,
      executionLimitPerCycle: 10_000
    })
    expect(meter).toMatchObject({ customPriceType: 'fixed', usageUnit: 'execution' })
    expect(toBillingMeterCreateBody(meter, meter.tiers[0])).toEqual({
      productType: 'workflow_trigger',
      productId: 'contact_scored',
      productName: 'Contact scored',
      customPriceType: 'fixed',
      usageUnit: 'execution',
      tierName: 'Trigger executions',
      minVolume: 0,
      pricePerUnit: 0.002,
      executionLimitPerCycle: 10_000
    })
    expect(toBillingMeterUpdateBody(meter, meter.tiers[0])).toEqual({
      name: 'Trigger executions',
      productName: 'Contact scored',
      customPriceType: 'fixed',
      usageUnit: 'execution',
      minVolume: 0,
      pricePerUnit: 0.002,
      executionLimitPerCycle: 10_000
    })
  })
})
