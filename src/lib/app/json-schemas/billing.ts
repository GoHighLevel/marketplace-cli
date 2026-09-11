import { MAX_PLANS, MAX_PLAN_FEATURES } from '../../billing/pricing.js'
import {
  arrayOf,
  booleanValue,
  integer,
  nonEmptyString,
  nullableNumber,
  object,
  reference,
  rootSchema,
  stringValue
} from './builders.js'

export const subscriptionSchema = rootSchema(
  'subscription',
  'HighLevel Subscription Plans',
  {
    schemaVersion: { const: 1 },
    appId: nonEmptyString(),
    plans: arrayOf(reference('subscriptionPlan'), { maxItems: MAX_PLANS })
  },
  ['schemaVersion', 'appId', 'plans'],
  {
    subscriptionPlan: object(
      {
        id: nonEmptyString(),
        name: nonEmptyString(),
        features: arrayOf(nonEmptyString(), { maxItems: MAX_PLAN_FEATURES }),
        paymentTime: { enum: ['month', 'year', 'life_time'] },
        paymentType: { enum: ['recurring', 'one_time'] },
        amount: { type: 'number', minimum: 0 },
        locationAmount: { type: 'number', minimum: 0 },
        freePlan: booleanValue(),
        freeForAgency: booleanValue(),
        freeForLocation: booleanValue()
      },
      ['name', 'features', 'paymentTime', 'paymentType', 'amount', 'freePlan', 'freeForAgency', 'freeForLocation']
    )
  }
)

export const usageBasedSchema = rootSchema(
  'usage-based',
  'HighLevel Usage-Based Billing',
  {
    schemaVersion: { const: 1 },
    appId: nonEmptyString(),
    meters: arrayOf(reference('usageMeter'))
  },
  ['schemaVersion', 'appId', 'meters'],
  {
    usageTier: object(
      {
        id: nonEmptyString(),
        name: nonEmptyString(),
        minVolume: { type: 'number', minimum: 0 },
        maxVolume: nullableNumber({ exclusiveMinimum: 0 }),
        pricePerUnit: { type: 'number', minimum: 0.000001, maximum: 200 },
        minPricePerUnit: { type: 'number', minimum: 0.000001, maximum: 200 },
        maxPricePerUnit: { type: 'number', minimum: 0.000001, maximum: 200 },
        executionLimitPerCycle: integer(1)
      },
      ['name', 'minVolume', 'maxVolume', 'pricePerUnit', 'executionLimitPerCycle']
    ),
    usageMeter: object(
      {
        id: nonEmptyString(),
        productType: { enum: ['conversation_provider', 'workflow_action', 'workflow_trigger', 'custom'] },
        productId: { type: 'string', minLength: 1, maxLength: 250 },
        productName: nonEmptyString(),
        customPriceType: { enum: ['fixed', 'dynamic'] },
        usageUnit: { type: 'string', minLength: 1, maxLength: 19 },
        direction: { enum: ['inbound', 'outbound'] },
        pricingPageUrl: stringValue(),
        tiers: arrayOf(reference('usageTier'), { minItems: 1 })
      },
      ['productType', 'productId', 'productName', 'customPriceType', 'usageUnit', 'tiers']
    )
  }
)
