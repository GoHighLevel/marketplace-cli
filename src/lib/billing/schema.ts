import { isRecord } from '../api/response.js'
import {
  BillingSubscriptionManifest,
  BillingSubscriptionPlan,
  BillingUsageManifest,
  BillingUsageMeterDefinition,
  BillingUsageTierDefinition
} from './manifest.js'
import { MAX_PLANS, MAX_PLAN_FEATURES, MAX_TEMPLATE_PLANS, requirePricingEditable } from './pricing.js'
import { validateHttpsUrl, validateTextForWhiteLabel } from '../shared/validation.js'

export interface BillingSubscriptionValidationOptions {
  billingType: 'free' | 'paid' | 'freemium'
  status?: string
  appType?: string
  userTypes: string[]
  externalBilling?: boolean
  whiteLabel: boolean
  mutationRequested?: boolean
  configurationMutationRequested?: boolean
  contextual?: boolean
}

export interface BillingUsageValidationOptions {
  appType?: string
  externalBilling: boolean
  actionKeys?: Set<string>
  triggerKeys?: Set<string>
  registeredActionKeys?: Set<string>
  registeredTriggerKeys?: Set<string>
  mutationRequested?: boolean
}

const SUBSCRIPTION_ROOT_KEYS = new Set(['schemaVersion', 'appId', 'plans'])
const PLAN_KEYS = new Set([
  'id',
  'name',
  'features',
  'paymentTime',
  'paymentType',
  'amount',
  'locationAmount',
  'freePlan',
  'freeForAgency',
  'freeForLocation'
])
const USAGE_ROOT_KEYS = new Set(['schemaVersion', 'appId', 'meters'])
const METER_KEYS = new Set([
  'id',
  'productType',
  'productId',
  'productName',
  'customPriceType',
  'usageUnit',
  'direction',
  'pricingPageUrl',
  'tiers'
])
const TIER_KEYS = new Set([
  'id',
  'name',
  'minVolume',
  'maxVolume',
  'pricePerUnit',
  'minPricePerUnit',
  'maxPricePerUnit',
  'executionLimitPerCycle'
])

function unknownKeyErrors(value: Record<string, unknown>, allowed: Set<string>, path: string): string[] {
  return Object.keys(value)
    .filter(key => !allowed.has(key))
    .map(key => `${path}.${key} is not supported.`)
}

function hasAtMostDecimals(value: number, decimalPlaces: number): boolean {
  if (!Number.isFinite(value)) return false
  const normalized = value.toString().toLowerCase()
  const [coefficient, exponentText] = normalized.split('e')
  const decimalCount = coefficient.includes('.') ? coefficient.length - coefficient.indexOf('.') - 1 : 0
  const exponent = Number(exponentText ?? 0)
  return Math.max(0, decimalCount - exponent) <= decimalPlaces
}

function validateCurrency(value: unknown, path: string, allowZero = false): string[] {
  if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path} must be a finite number.`]
  if ((!allowZero && value < 0.01) || (allowZero && value < 0)) {
    return [`${path} must be ${allowZero ? 'at least 0' : 'at least 0.01'}.`]
  }
  return hasAtMostDecimals(value, 2) ? [] : [`${path} may have at most two decimal places.`]
}

function validatePlan(value: unknown, index: number, options: BillingSubscriptionValidationOptions): string[] {
  const path = `subscription.json.plans[${index}]`
  if (!isRecord(value)) return [`${path} must be an object.`]
  const errors = unknownKeyErrors(value, PLAN_KEYS, path)
  if ('id' in value && (typeof value.id !== 'string' || !value.id.trim())) {
    errors.push(`${path}.id must be a non-empty string when provided.`)
  }
  if (typeof value.name !== 'string' || !value.name.trim()) {
    errors.push(`${path}.name must be a non-empty string.`)
  } else if (options.whiteLabel) {
    const result = validateTextForWhiteLabel(value.name, `${path}.name`)
    if (result !== true) errors.push(result)
  }
  if (!Array.isArray(value.features)) {
    errors.push(`${path}.features must be an array.`)
  } else {
    if (value.features.length > MAX_PLAN_FEATURES) {
      errors.push(`${path}.features can contain at most ${MAX_PLAN_FEATURES} entries.`)
    }
    value.features.forEach((feature, featureIndex) => {
      if (typeof feature !== 'string' || !feature.trim()) {
        errors.push(`${path}.features[${featureIndex}] must be a non-empty string.`)
      } else if (options.whiteLabel) {
        const result = validateTextForWhiteLabel(feature, `${path}.features[${featureIndex}]`)
        if (result !== true) errors.push(result)
      }
    })
  }
  if (!['month', 'year', 'life_time'].includes(String(value.paymentTime))) {
    errors.push(`${path}.paymentTime must be "month", "year", or "life_time".`)
  }
  if (!['recurring', 'one_time'].includes(String(value.paymentType))) {
    errors.push(`${path}.paymentType must be "recurring" or "one_time".`)
  }
  const expectedPaymentType = value.paymentTime === 'life_time' ? 'one_time' : 'recurring'
  if (['month', 'year', 'life_time'].includes(String(value.paymentTime)) && value.paymentType !== expectedPaymentType) {
    errors.push(`${path}.paymentTime "${value.paymentTime}" requires paymentType "${expectedPaymentType}".`)
  }
  for (const key of ['freePlan', 'freeForAgency', 'freeForLocation'] as const) {
    if (typeof value[key] !== 'boolean') errors.push(`${path}.${key} must be a boolean.`)
  }
  const plan = value as unknown as BillingSubscriptionPlan
  if (typeof value.freeForAgency === 'boolean') {
    errors.push(...validateCurrency(value.amount, `${path}.amount`, value.freeForAgency))
    if (value.freeForAgency && value.amount !== 0) errors.push(`${path}.amount must be 0 when freeForAgency is true.`)
  }
  if (value.locationAmount !== undefined) {
    errors.push(...validateCurrency(value.locationAmount, `${path}.locationAmount`, value.freeForLocation === true))
    if (value.freeForLocation === true && value.locationAmount !== 0) {
      errors.push(`${path}.locationAmount must be 0 when freeForLocation is true.`)
    }
  }
  if (value.freePlan === true) {
    if (options.contextual !== false && options.billingType !== 'freemium') {
      errors.push(`${path}.freePlan is only supported for freemium apps.`)
    }
    if (!value.freeForAgency || !value.freeForLocation || value.amount !== 0 || value.locationAmount !== 0) {
      errors.push(`${path} must be free for both agencies and sub-accounts with both amounts set to 0.`)
    }
  } else if (value.freeForAgency === true && value.freeForLocation === true) {
    errors.push(`${path} cannot be free for both agencies and sub-accounts unless freePlan is true.`)
  }
  if (value.freeForAgency === true && value.freePlan !== true &&
    (typeof value.locationAmount !== 'number' || value.locationAmount < 0.01)) {
    errors.push(`${path}.locationAmount is required when the plan is free for agencies.`)
  }
  if (value.freeForLocation === true && value.freePlan !== true &&
    (typeof value.amount !== 'number' || value.amount < 0.01)) {
    errors.push(`${path}.amount is required when the plan is free for sub-accounts.`)
  }
  const hasSplitPricing = plan.freePlan !== true && (
    plan.locationAmount !== undefined || plan.freeForAgency || plan.freeForLocation
  )
  if (options.contextual !== false && hasSplitPricing && options.userTypes.length < 2) {
    errors.push(`${path} uses sub-account pricing, which requires the app to target both agencies and sub-accounts.`)
  }
  if (options.contextual !== false && options.appType === 'template' && value.paymentTime !== 'life_time') {
    errors.push(`${path}.paymentTime must be "life_time" for template apps.`)
  }
  return errors
}

export function validateBillingSubscriptionManifest(
  value: unknown,
  options: BillingSubscriptionValidationOptions
): string[] {
  if (!isRecord(value)) return ['subscription.json must contain an object.']
  const errors = unknownKeyErrors(value, SUBSCRIPTION_ROOT_KEYS, 'subscription.json')
  if (value.schemaVersion !== 1) errors.push('subscription.json.schemaVersion must be 1.')
  if (typeof value.appId !== 'string' || !value.appId.trim()) {
    errors.push('subscription.json.appId must be a non-empty string.')
  }
  if (!Array.isArray(value.plans)) {
    errors.push('subscription.json.plans must be an array.')
    return errors
  }
  if (options.contextual !== false) {
    const maxPlans = options.appType === 'template' ? MAX_TEMPLATE_PLANS : MAX_PLANS
    if (value.plans.length > maxPlans) {
      errors.push(`subscription.json.plans can contain at most ${maxPlans} plan${maxPlans === 1 ? '' : 's'}.`)
    }
  }
  value.plans.forEach((plan, index) => errors.push(...validatePlan(plan, index, options)))
  const ids = new Set<string>()
  const names = new Set<string>()
  value.plans.forEach((plan, index) => {
    if (!isRecord(plan)) return
    if (typeof plan.id === 'string') {
      if (ids.has(plan.id)) errors.push(`subscription.json.plans[${index}].id duplicates plan id "${plan.id}".`)
      ids.add(plan.id)
    }
    if (typeof plan.name === 'string' && plan.name.trim()) {
      const normalized = plan.name.trim().toLowerCase()
      if (names.has(normalized)) errors.push(`subscription.json.plans[${index}].name must be unique.`)
      names.add(normalized)
    }
  })
  if (options.mutationRequested) {
    try {
      requirePricingEditable(options.status)
    } catch (error) {
      errors.push((error as Error).message)
    }
    const configurationMutation = options.configurationMutationRequested ?? true
    if (configurationMutation && options.externalBilling) {
      errors.push('Subscription plans cannot be created or edited while external billing is enabled.')
    }
    if (configurationMutation && options.billingType === 'free') {
      errors.push('Subscription plans cannot be created or edited while the billing model is free.')
    }
  }
  return [...new Set(errors)]
}

function validateUnitPrice(value: unknown, path: string): string[] {
  if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path} must be a finite number.`]
  if (value < 0.000001 || value > 200) return [`${path} must be between 0.000001 and 200.`]
  return hasAtMostDecimals(value, 6) ? [] : [`${path} may have at most six decimal places.`]
}

function validateTier(value: unknown, meterIndex: number, tierIndex: number, dynamic: boolean): string[] {
  const path = `usage-based.json.meters[${meterIndex}].tiers[${tierIndex}]`
  if (!isRecord(value)) return [`${path} must be an object.`]
  const errors = unknownKeyErrors(value, TIER_KEYS, path)
  if ('id' in value && (typeof value.id !== 'string' || !value.id.trim())) {
    errors.push(`${path}.id must be a non-empty string when provided.`)
  }
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push(`${path}.name must be a non-empty string.`)
  if (typeof value.minVolume !== 'number' || !Number.isFinite(value.minVolume) || value.minVolume < 0) {
    errors.push(`${path}.minVolume must be a non-negative finite number.`)
  }
  if (value.maxVolume !== null &&
    (typeof value.maxVolume !== 'number' || !Number.isFinite(value.maxVolume) || value.maxVolume <= Number(value.minVolume))) {
    errors.push(`${path}.maxVolume must be null or greater than minVolume.`)
  }
  errors.push(...validateUnitPrice(value.pricePerUnit, `${path}.pricePerUnit`))
  if (typeof value.executionLimitPerCycle !== 'number' || !Number.isInteger(value.executionLimitPerCycle) ||
    value.executionLimitPerCycle < 1) {
    errors.push(`${path}.executionLimitPerCycle must be a positive integer.`)
  }
  if (dynamic) {
    errors.push(...validateUnitPrice(value.minPricePerUnit, `${path}.minPricePerUnit`))
    errors.push(...validateUnitPrice(value.maxPricePerUnit, `${path}.maxPricePerUnit`))
    if (typeof value.minPricePerUnit === 'number' && typeof value.maxPricePerUnit === 'number') {
      if (value.minPricePerUnit >= value.maxPricePerUnit) {
        errors.push(`${path}.minPricePerUnit must be less than maxPricePerUnit.`)
      }
      if (typeof value.pricePerUnit === 'number' &&
        (value.pricePerUnit < value.minPricePerUnit || value.pricePerUnit > value.maxPricePerUnit)) {
        errors.push(`${path}.pricePerUnit must be between minPricePerUnit and maxPricePerUnit.`)
      }
    }
  } else {
    if (value.minPricePerUnit !== undefined) errors.push(`${path}.minPricePerUnit is only supported for dynamic pricing.`)
    if (value.maxPricePerUnit !== undefined) errors.push(`${path}.maxPricePerUnit is only supported for dynamic pricing.`)
  }
  return errors
}

function validateTierRanges(meter: BillingUsageMeterDefinition, meterIndex: number): string[] {
  const sorted = [...meter.tiers].sort((left, right) => left.minVolume - right.minVolume)
  const errors: string[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (previous.maxVolume === null || current.minVolume <= previous.maxVolume) {
      errors.push(`usage-based.json.meters[${meterIndex}].tiers contains overlapping volume ranges.`)
      break
    }
  }
  return errors
}

function validateMeter(value: unknown, index: number, options: BillingUsageValidationOptions): string[] {
  const path = `usage-based.json.meters[${index}]`
  if (!isRecord(value)) return [`${path} must be an object.`]
  const errors = unknownKeyErrors(value, METER_KEYS, path)
  if ('id' in value && (typeof value.id !== 'string' || !value.id.trim())) {
    errors.push(`${path}.id must be a non-empty string when provided.`)
  }
  const productTypes = ['conversation_provider', 'workflow_action', 'workflow_trigger', 'custom']
  if (!productTypes.includes(String(value.productType))) {
    errors.push(`${path}.productType must be "conversation_provider", "workflow_action", "workflow_trigger", or "custom".`)
  }
  for (const field of ['productId', 'productName', 'usageUnit'] as const) {
    if (typeof value[field] !== 'string' || !value[field].trim()) errors.push(`${path}.${field} must be a non-empty string.`)
  }
  if (typeof value.usageUnit === 'string' && value.usageUnit.length > 19) {
    errors.push(`${path}.usageUnit must contain at most 19 characters.`)
  }
  if (!['fixed', 'dynamic'].includes(String(value.customPriceType))) {
    errors.push(`${path}.customPriceType must be "fixed" or "dynamic".`)
  }
  if (value.productType !== 'custom' && value.customPriceType !== 'fixed') {
    errors.push(`${path}.productType "${value.productType}" only supports fixed pricing.`)
  }
  if (value.productType === 'conversation_provider') {
    if (!['inbound', 'outbound'].includes(String(value.direction))) {
      errors.push(`${path}.direction is required and must be "inbound" or "outbound" for a conversation provider.`)
    }
    if (value.usageUnit !== 'message') errors.push(`${path}.usageUnit must be "message" for a conversation provider.`)
  } else if (value.direction !== undefined) {
    errors.push(`${path}.direction is only supported for conversation providers.`)
  }
  if (value.productType === 'workflow_action') {
    if (value.usageUnit !== 'execution') errors.push(`${path}.usageUnit must be "execution" for a workflow action.`)
    if (options.actionKeys && typeof value.productId === 'string' && !options.actionKeys.has(value.productId)) {
      errors.push(`${path}.productId must reference a local workflow action key.`)
    }
    if (options.registeredActionKeys && typeof value.productId === 'string' &&
      !options.registeredActionKeys.has(value.productId)) {
      errors.push(`${path}.productId must reference a remotely registered workflow action; push the action first.`)
    }
  }
  if (value.productType === 'workflow_trigger') {
    if (value.usageUnit !== 'execution') errors.push(`${path}.usageUnit must be "execution" for a workflow trigger.`)
    if (options.triggerKeys && typeof value.productId === 'string' && !options.triggerKeys.has(value.productId)) {
      errors.push(`${path}.productId must reference a local workflow trigger key.`)
    }
    if (options.registeredTriggerKeys && typeof value.productId === 'string' &&
      !options.registeredTriggerKeys.has(value.productId)) {
      errors.push(`${path}.productId must reference a remotely registered workflow trigger; push the trigger first.`)
    }
  }
  if (value.productType === 'custom' && typeof value.productId === 'string' && !/^custom_[A-Za-z0-9_-]+$/.test(value.productId)) {
    errors.push(`${path}.productId must start with "custom_" and contain only letters, numbers, underscores, or hyphens.`)
  }
  if (value.customPriceType === 'dynamic') {
    if (typeof value.pricingPageUrl !== 'string' || !value.pricingPageUrl.trim()) {
      errors.push(`${path}.pricingPageUrl is required for dynamic pricing.`)
    }
  } else if (value.pricingPageUrl !== undefined) {
    errors.push(`${path}.pricingPageUrl is only supported for dynamic pricing.`)
  }
  if (typeof value.pricingPageUrl === 'string' && value.pricingPageUrl.trim()) {
    const result = validateHttpsUrl(value.pricingPageUrl, `${path}.pricingPageUrl`, { publicOnly: true })
    if (result !== true) errors.push(result)
  }
  if (!Array.isArray(value.tiers) || value.tiers.length === 0) {
    errors.push(`${path}.tiers must contain at least one tier.`)
  } else {
    value.tiers.forEach((tier, tierIndex) => {
      errors.push(...validateTier(tier, index, tierIndex, value.customPriceType === 'dynamic'))
    })
    errors.push(...validateTierRanges(value as unknown as BillingUsageMeterDefinition, index))
    const ids = new Set<string>()
    value.tiers.forEach((tier, tierIndex) => {
      if (!isRecord(tier) || typeof tier.id !== 'string') return
      if (ids.has(tier.id)) errors.push(`${path}.tiers[${tierIndex}].id duplicates tier id "${tier.id}".`)
      ids.add(tier.id)
    })
  }
  return errors
}

export function validateBillingUsageManifest(value: unknown, options: BillingUsageValidationOptions): string[] {
  if (!isRecord(value)) return ['usage-based.json must contain an object.']
  const errors = unknownKeyErrors(value, USAGE_ROOT_KEYS, 'usage-based.json')
  if (value.schemaVersion !== 1) errors.push('usage-based.json.schemaVersion must be 1.')
  if (typeof value.appId !== 'string' || !value.appId.trim()) {
    errors.push('usage-based.json.appId must be a non-empty string.')
  }
  if (!Array.isArray(value.meters)) {
    errors.push('usage-based.json.meters must be an array.')
    return errors
  }
  if (value.meters.length > 0 && options.mutationRequested && options.externalBilling) {
    errors.push('Usage-based billing is not available while external billing is enabled.')
  }
  if (value.meters.length > 0 && options.mutationRequested && options.appType === 'template') {
    errors.push('Usage-based billing is not available for template apps.')
  }
  value.meters.forEach((meter, index) => errors.push(...validateMeter(meter, index, options)))
  const ids = new Set<string>()
  const products = new Set<string>()
  value.meters.forEach((meter, index) => {
    if (!isRecord(meter)) return
    if (typeof meter.id === 'string') {
      if (ids.has(meter.id)) errors.push(`usage-based.json.meters[${index}].id duplicates meter id "${meter.id}".`)
      ids.add(meter.id)
    }
    if (typeof meter.productId === 'string') {
      const productKey = `${meter.productId}:${typeof meter.direction === 'string' ? meter.direction : ''}`
      if (products.has(productKey)) {
        errors.push(`usage-based.json.meters[${index}] duplicates productId and direction "${productKey}".`)
      }
      products.add(productKey)
    }
  })
  return [...new Set(errors)]
}
