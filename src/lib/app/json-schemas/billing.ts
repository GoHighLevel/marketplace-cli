import { MAX_PLANS, MAX_PLAN_FEATURES } from '../../billing/pricing.js'
import {
  RESOURCE_IDENTIFIER_PATTERN,
  arrayOf,
  booleanValue,
  integer,
  nonBlankString,
  nullableNumber,
  object,
  reference,
  requiredHttpsUrl,
  rootSchema,
  type JsonSchema
} from './builders.js'

/* Decimal-place limits are enforced by the CLI on the number's decimal text.
   JSON Schema `multipleOf` divides binary floating-point values and rejects
   ordinary prices such as 199.99, so it is intentionally not used here. */
const currency = (description: string): JsonSchema => ({
  type: 'number',
  minimum: 0,
  description: `${description} Use at most two decimal places.`
})

const unitPrice = (description: string): JsonSchema => ({
  type: 'number',
  minimum: 0.000001,
  maximum: 200,
  description: `${description} Use at most six decimal places.`
})

const subscriptionPlan: JsonSchema = {
  ...object(
    {
      id: nonBlankString({ description: 'Server-assigned plan id when present.' }),
      name: nonBlankString({ description: 'Unique, non-blank marketplace plan name.' }),
      features: arrayOf(nonBlankString(), {
        maxItems: MAX_PLAN_FEATURES,
        description: `Up to ${MAX_PLAN_FEATURES} non-blank plan features.`
      }),
      paymentTime: {
        enum: ['month', 'year', 'life_time'],
        description: 'Billing interval; life_time plans are one-time purchases.'
      },
      paymentType: {
        enum: ['recurring', 'one_time'],
        description: 'Must be recurring for month/year and one_time for life_time.'
      },
      amount: currency('Agency price. Paid access requires at least 0.01.'),
      locationAmount: currency('Optional sub-account price. Paid access requires at least 0.01.'),
      freePlan: booleanValue({ description: 'Whether this is the freemium free plan.' }),
      freeForAgency: booleanValue({ description: 'Whether agencies receive this plan for free.' }),
      freeForLocation: booleanValue({ description: 'Whether sub-accounts receive this plan for free.' })
    },
    ['name', 'features', 'paymentTime', 'paymentType', 'amount', 'freePlan', 'freeForAgency', 'freeForLocation']
  ),
  description:
    'A subscription plan. The CLI additionally checks app type, billing model, status, and unique names/ids.',
  allOf: [
    {
      if: { properties: { paymentTime: { const: 'life_time' } }, required: ['paymentTime'] },
      then: { properties: { paymentType: { const: 'one_time' } } },
      else: { properties: { paymentType: { const: 'recurring' } } }
    },
    {
      if: { properties: { freeForAgency: { const: true } }, required: ['freeForAgency'] },
      then: { properties: { amount: { const: 0 } } },
      else: { properties: { amount: { minimum: 0.01 } } }
    },
    {
      if: { properties: { freeForLocation: { const: true } }, required: ['freeForLocation'] },
      then: { properties: { locationAmount: { const: 0 } } },
      else: { properties: { locationAmount: { minimum: 0.01 } } }
    },
    {
      if: { properties: { freePlan: { const: true } }, required: ['freePlan'] },
      then: {
        properties: {
          freeForAgency: { const: true },
          freeForLocation: { const: true },
          amount: { const: 0 },
          locationAmount: { const: 0 }
        },
        required: ['locationAmount']
      },
      else: {
        not: {
          properties: { freeForAgency: { const: true }, freeForLocation: { const: true } },
          required: ['freeForAgency', 'freeForLocation']
        }
      }
    },
    {
      if: {
        properties: { freePlan: { const: false }, freeForAgency: { const: true } },
        required: ['freePlan', 'freeForAgency']
      },
      then: { properties: { locationAmount: { minimum: 0.01 } }, required: ['locationAmount'] }
    },
    {
      if: {
        properties: { freePlan: { const: false }, freeForLocation: { const: true } },
        required: ['freePlan', 'freeForLocation']
      },
      then: { properties: { amount: { minimum: 0.01 } } }
    }
  ]
}

export const subscriptionSchema = rootSchema(
  'subscription',
  'HighLevel Subscription Plans',
  {
    schemaVersion: { const: 1, description: 'Generated subscription manifest schema version.' },
    appId: nonBlankString({
      pattern: RESOURCE_IDENTIFIER_PATTERN,
      description: 'HighLevel app identifier associated with these plans.'
    }),
    plans: arrayOf(reference('subscriptionPlan'), {
      maxItems: MAX_PLANS,
      description: `Subscription plans; standard apps support up to ${MAX_PLANS}. Template apps support one plan, enforced contextually by the CLI.`
    })
  },
  ['schemaVersion', 'appId', 'plans'],
  { subscriptionPlan }
)

const usageTier = object(
  {
    id: nonBlankString({ description: 'Server-assigned tier id when present.' }),
    name: nonBlankString({ description: 'Non-blank tier name.' }),
    minVolume: { type: 'number', minimum: 0, description: 'Inclusive lower volume boundary.' },
    maxVolume: nullableNumber({
      exclusiveMinimum: 0,
      description:
        'Upper volume boundary, or null for the final open-ended tier. The CLI verifies it exceeds minVolume.'
    }),
    pricePerUnit: unitPrice('Default price per unit; 0.000001–200 with at most six decimal places.'),
    minPricePerUnit: unitPrice('Dynamic minimum price per unit.'),
    maxPricePerUnit: unitPrice('Dynamic maximum price per unit.'),
    executionLimitPerCycle: integer(1, undefined, { description: 'Positive execution limit for each billing cycle.' })
  },
  ['name', 'minVolume', 'maxVolume', 'pricePerUnit', 'executionLimitPerCycle']
)

const usageMeter: JsonSchema = {
  ...object(
    {
      id: nonBlankString({ description: 'Server-assigned meter id when present.' }),
      productType: {
        enum: ['conversation_provider', 'workflow_action', 'workflow_trigger', 'custom'],
        description: 'Product surface metered by this definition.'
      },
      productId: nonBlankString({
        maxLength: 250,
        description: 'Product identifier. Custom products must use the custom_ prefix.'
      }),
      productName: nonBlankString({ description: 'Display name for the metered product.' }),
      customPriceType: { enum: ['fixed', 'dynamic'], description: 'Fixed or dynamic unit pricing.' },
      usageUnit: nonBlankString({ maxLength: 19, description: 'Usage unit; workflow resources use execution.' }),
      direction: { enum: ['inbound', 'outbound'], description: 'Required only for conversation providers.' },
      pricingPageUrl: requiredHttpsUrl('Required public HTTPS pricing page for dynamic custom pricing.'),
      tiers: arrayOf(reference('usageTier'), { minItems: 1, description: 'One or more non-overlapping usage tiers.' })
    },
    ['productType', 'productId', 'productName', 'customPriceType', 'usageUnit', 'tiers']
  ),
  description:
    'A usage meter. The CLI additionally resolves workflow references and checks tier ordering and uniqueness.',
  allOf: [
    {
      if: { properties: { productType: { const: 'custom' } }, required: ['productType'] },
      then: { properties: { productId: { pattern: '^custom_[A-Za-z0-9_-]+$', maxLength: 250 } } },
      else: { properties: { customPriceType: { const: 'fixed' } } }
    },
    {
      if: { properties: { productType: { const: 'conversation_provider' } }, required: ['productType'] },
      then: {
        properties: { direction: { enum: ['inbound', 'outbound'] }, usageUnit: { const: 'message' } },
        required: ['direction']
      },
      else: { not: { required: ['direction'] } }
    },
    {
      if: {
        properties: { productType: { enum: ['workflow_action', 'workflow_trigger'] } },
        required: ['productType']
      },
      then: { properties: { usageUnit: { const: 'execution' } } }
    },
    {
      if: { properties: { customPriceType: { const: 'dynamic' } }, required: ['customPriceType'] },
      then: {
        required: ['pricingPageUrl'],
        properties: {
          tiers: {
            items: {
              allOf: [reference('usageTier'), { required: ['minPricePerUnit', 'maxPricePerUnit'] }]
            }
          }
        }
      },
      else: {
        not: { required: ['pricingPageUrl'] },
        properties: {
          tiers: {
            items: {
              allOf: [
                reference('usageTier'),
                { not: { anyOf: [{ required: ['minPricePerUnit'] }, { required: ['maxPricePerUnit'] }] } }
              ]
            }
          }
        }
      }
    }
  ]
}

export const usageBasedSchema = rootSchema(
  'usage-based',
  'HighLevel Usage-Based Billing',
  {
    schemaVersion: { const: 1, description: 'Generated usage billing manifest schema version.' },
    appId: nonBlankString({
      pattern: RESOURCE_IDENTIFIER_PATTERN,
      description: 'HighLevel app identifier associated with these meters.'
    }),
    meters: arrayOf(reference('usageMeter'), {
      description: 'Usage meters. The CLI checks unique ids/products and app-level billing eligibility.'
    })
  },
  ['schemaVersion', 'appId', 'meters'],
  { usageTier, usageMeter }
)
