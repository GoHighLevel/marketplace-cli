import { hasOptionalBooleanFields, hasOptionalFiniteNumberFields, hasOptionalStringFields } from './fields.js'
import { isRecord } from '../response.js'
import type { BillingPlan, BillingUsageMeter, BillingUsageTier } from '../types.js'

export function isBillingPlan(value: unknown): value is BillingPlan {
  if (!isRecord(value)) return false
  const id = value._id ?? value.id
  const amount = value.price ?? value.amount
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    Array.isArray(value.features) &&
    value.features.every(feature => typeof feature === 'string') &&
    ['month', 'year', 'life_time'].includes(String(value.paymentTime)) &&
    ['recurring', 'one_time'].includes(String(value.paymentType)) &&
    typeof amount === 'number' &&
    Number.isFinite(amount) &&
    hasOptionalStringFields(value, ['_id', 'id', 'name', 'paymentType', 'paymentTime']) &&
    hasOptionalFiniteNumberFields(value, ['price', 'locationPrice', 'amount', 'locationAmount'], true) &&
    hasOptionalBooleanFields(value, ['isFreemiumPlan', 'freeForAgency', 'freeForLocation', 'freePlan'])
  )
}

function isBillingUsageTier(value: unknown): value is BillingUsageTier {
  return (
    isRecord(value) &&
    typeof value._id === 'string' &&
    value._id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.minVolume === 'number' &&
    Number.isFinite(value.minVolume) &&
    (value.maxVolume === undefined ||
      value.maxVolume === null ||
      (typeof value.maxVolume === 'number' && Number.isFinite(value.maxVolume))) &&
    typeof value.pricePerUnit === 'number' &&
    Number.isFinite(value.pricePerUnit) &&
    hasOptionalFiniteNumberFields(value, ['minPricePerUnit', 'maxPricePerUnit'], true) &&
    typeof value.executionLimitPerCycle === 'number' &&
    Number.isFinite(value.executionLimitPerCycle)
  )
}

export function isBillingUsageMeter(value: unknown): value is BillingUsageMeter {
  return (
    isRecord(value) &&
    typeof value._id === 'string' &&
    value._id.length > 0 &&
    hasOptionalStringFields(value, ['appId', 'pricingPageURL']) &&
    ['conversation_provider', 'workflow_action', 'workflow_trigger', 'custom'].includes(String(value.productType)) &&
    typeof value.productId === 'string' &&
    value.productId.trim().length > 0 &&
    typeof value.productName === 'string' &&
    value.productName.trim().length > 0 &&
    ['fixed', 'dynamic'].includes(String(value.customPriceType)) &&
    typeof value.usageUnit === 'string' &&
    value.usageUnit.trim().length > 0 &&
    (value.direction === undefined || ['inbound', 'outbound'].includes(String(value.direction))) &&
    Array.isArray(value.billingTier) &&
    value.billingTier.every(isBillingUsageTier)
  )
}
