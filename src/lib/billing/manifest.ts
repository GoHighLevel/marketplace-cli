import type { BillingPlan, BillingUsageMeter } from '../api/types.js'

export type BillingPaymentTime = 'month' | 'year' | 'life_time'
export type BillingPaymentType = 'recurring' | 'one_time'
export type BillingProductType = 'conversation_provider' | 'workflow_action' | 'workflow_trigger' | 'custom'
export type BillingCustomPriceType = 'fixed' | 'dynamic'

export interface BillingSubscriptionPlan {
  id?: string
  name: string
  features: string[]
  paymentTime: BillingPaymentTime
  paymentType: BillingPaymentType
  amount: number
  locationAmount?: number
  freePlan: boolean
  freeForAgency: boolean
  freeForLocation: boolean
}

export interface BillingSubscriptionManifest {
  schemaVersion: 1
  appId: string
  plans: BillingSubscriptionPlan[]
}

export interface BillingUsageTierDefinition {
  id?: string
  name: string
  minVolume: number
  maxVolume: number | null
  pricePerUnit: number
  minPricePerUnit?: number
  maxPricePerUnit?: number
  executionLimitPerCycle: number
}

export interface BillingUsageMeterDefinition {
  id?: string
  productType: BillingProductType
  productId: string
  productName: string
  customPriceType: BillingCustomPriceType
  usageUnit: string
  direction?: 'inbound' | 'outbound'
  pricingPageUrl?: string
  tiers: BillingUsageTierDefinition[]
}

export interface BillingUsageManifest {
  schemaVersion: 1
  appId: string
  meters: BillingUsageMeterDefinition[]
}

export interface CreateBillingPlanScaffoldInput {
  name: string
  amount: number
  locationAmount?: number
  paymentTime: BillingPaymentTime
  features?: string[]
  freePlan?: boolean
  freeForAgency?: boolean
  freeForLocation?: boolean
}

export interface CreateBillingMeterScaffoldInput {
  productType: BillingProductType
  productId: string
  productName: string
  name: string
  pricePerUnit: number
  executionLimitPerCycle: number
  direction?: 'inbound' | 'outbound'
  usageUnit?: string
  customPriceType?: BillingCustomPriceType
  minPricePerUnit?: number
  maxPricePerUnit?: number
  pricingPageUrl?: string
}

function planId(plan: BillingPlan): string {
  const id = plan._id ?? plan.id
  if (!id) throw new Error('Billing plan API response is missing a plan id.')
  return id
}

function remoteAmount(
  plan: BillingPlan,
  field: 'price' | 'locationPrice',
  legacy: 'amount' | 'locationAmount'
): number | undefined {
  const value = plan[field] ?? plan[legacy]
  return typeof value === 'number' ? value : undefined
}

function mapBillingPlan(plan: BillingPlan): BillingSubscriptionPlan {
  const freePlan = Boolean(plan.isFreemiumPlan ?? plan.freePlan)
  const freeForAgency = Boolean(plan.freeForAgency ?? freePlan)
  const freeForLocation = Boolean(plan.freeForLocation ?? freePlan)
  const amount = remoteAmount(plan, 'price', 'amount') ?? (freeForAgency ? 0 : Number.NaN)
  const locationAmount = remoteAmount(plan, 'locationPrice', 'locationAmount')
  return {
    id: planId(plan),
    name: plan.name ?? '',
    features: plan.features ?? [],
    paymentTime: plan.paymentTime as BillingPaymentTime,
    paymentType: plan.paymentType as BillingPaymentType,
    amount,
    ...(locationAmount !== undefined ? { locationAmount } : {}),
    freePlan,
    freeForAgency,
    freeForLocation
  }
}

export function buildBillingSubscriptionManifest(appId: string, plans: BillingPlan[]): BillingSubscriptionManifest {
  return {
    schemaVersion: 1,
    appId,
    plans: plans.map(mapBillingPlan).sort((left, right) => (left.id as string).localeCompare(right.id as string))
  }
}

function mapBillingTier(tier: BillingUsageMeter['billingTier'][number]): BillingUsageTierDefinition {
  return {
    id: tier._id,
    name: tier.name,
    minVolume: tier.minVolume,
    maxVolume: tier.maxVolume === undefined || tier.maxVolume === null ? null : tier.maxVolume,
    pricePerUnit: tier.pricePerUnit,
    ...(typeof tier.minPricePerUnit === 'number' ? { minPricePerUnit: tier.minPricePerUnit } : {}),
    ...(typeof tier.maxPricePerUnit === 'number' ? { maxPricePerUnit: tier.maxPricePerUnit } : {}),
    executionLimitPerCycle: tier.executionLimitPerCycle
  }
}

function mapBillingMeter(meter: BillingUsageMeter): BillingUsageMeterDefinition {
  return {
    id: meter._id,
    productType: meter.productType,
    productId: meter.productId,
    productName: meter.productName,
    customPriceType: meter.customPriceType,
    usageUnit: meter.usageUnit,
    ...(meter.direction ? { direction: meter.direction } : {}),
    ...(meter.pricingPageURL ? { pricingPageUrl: meter.pricingPageURL } : {}),
    tiers: meter.billingTier
      .map(mapBillingTier)
      .sort((left, right) => (left.id as string).localeCompare(right.id as string))
  }
}

export function buildBillingUsageManifest(appId: string, meters: BillingUsageMeter[]): BillingUsageManifest {
  return {
    schemaVersion: 1,
    appId,
    meters: meters.map(mapBillingMeter).sort((left, right) => (left.id as string).localeCompare(right.id as string))
  }
}

export function emptyBillingSubscriptionManifest(appId: string): BillingSubscriptionManifest {
  return { schemaVersion: 1, appId, plans: [] }
}

export function emptyBillingUsageManifest(appId: string): BillingUsageManifest {
  return { schemaVersion: 1, appId, meters: [] }
}

export function createBillingPlanScaffold(input: CreateBillingPlanScaffoldInput): BillingSubscriptionPlan {
  const freePlan = input.freePlan ?? false
  const freeForAgency = input.freeForAgency ?? freePlan
  const freeForLocation = input.freeForLocation ?? freePlan
  return {
    name: input.name.trim(),
    features: input.features?.map(feature => feature.trim()) ?? [],
    paymentTime: input.paymentTime,
    paymentType: input.paymentTime === 'life_time' ? 'one_time' : 'recurring',
    amount: freeForAgency ? 0 : input.amount,
    ...(input.locationAmount !== undefined || freeForLocation
      ? { locationAmount: freeForLocation ? 0 : input.locationAmount }
      : {}),
    freePlan,
    freeForAgency,
    freeForLocation
  }
}

export function createBillingMeterScaffold(input: CreateBillingMeterScaffoldInput): BillingUsageMeterDefinition {
  const customPriceType = input.customPriceType ?? 'fixed'
  const usageUnit =
    input.usageUnit ??
    (input.productType === 'conversation_provider' ? 'message' : input.productType === 'custom' ? 'unit' : 'execution')
  return {
    productType: input.productType,
    productId: input.productId.trim(),
    productName: input.productName.trim(),
    customPriceType,
    usageUnit: usageUnit.trim().toLowerCase(),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.pricingPageUrl ? { pricingPageUrl: input.pricingPageUrl.trim() } : {}),
    tiers: [
      {
        name: input.name.trim(),
        minVolume: 0,
        maxVolume: null,
        pricePerUnit: input.pricePerUnit,
        ...(customPriceType === 'dynamic' && input.minPricePerUnit !== undefined
          ? { minPricePerUnit: input.minPricePerUnit }
          : {}),
        ...(customPriceType === 'dynamic' && input.maxPricePerUnit !== undefined
          ? { maxPricePerUnit: input.maxPricePerUnit }
          : {}),
        executionLimitPerCycle: input.executionLimitPerCycle
      }
    ]
  }
}

export function toBillingPlanCreateBody(plan: BillingSubscriptionPlan): Omit<BillingSubscriptionPlan, 'id'> {
  const { id: _id, ...body } = plan
  return structuredClone(body)
}

export function toBillingMeterCreateBody(
  meter: BillingUsageMeterDefinition,
  tier: BillingUsageTierDefinition
): Record<string, unknown> {
  return {
    productType: meter.productType,
    productId: meter.productId,
    productName: meter.productName,
    customPriceType: meter.customPriceType,
    usageUnit: meter.usageUnit,
    ...(meter.direction ? { direction: meter.direction } : {}),
    tierName: tier.name,
    minVolume: tier.minVolume,
    ...(tier.maxVolume !== null ? { maxVolume: tier.maxVolume } : {}),
    pricePerUnit: tier.pricePerUnit,
    ...(tier.minPricePerUnit !== undefined ? { minPricePerUnit: tier.minPricePerUnit } : {}),
    ...(tier.maxPricePerUnit !== undefined ? { maxPricePerUnit: tier.maxPricePerUnit } : {}),
    ...(meter.pricingPageUrl ? { pricingPageURL: meter.pricingPageUrl } : {}),
    executionLimitPerCycle: tier.executionLimitPerCycle
  }
}

export function toBillingMeterUpdateBody(
  meter: BillingUsageMeterDefinition,
  tier: BillingUsageTierDefinition
): Record<string, unknown> {
  return {
    name: tier.name,
    productName: meter.productName,
    customPriceType: meter.customPriceType,
    usageUnit: meter.usageUnit,
    minVolume: tier.minVolume,
    ...(tier.maxVolume !== null ? { maxVolume: tier.maxVolume } : {}),
    pricePerUnit: tier.pricePerUnit,
    ...(tier.minPricePerUnit !== undefined ? { minPricePerUnit: tier.minPricePerUnit } : {}),
    ...(tier.maxPricePerUnit !== undefined ? { maxPricePerUnit: tier.maxPricePerUnit } : {}),
    ...(meter.pricingPageUrl ? { pricingPageURL: meter.pricingPageUrl } : {}),
    executionLimitPerCycle: tier.executionLimitPerCycle
  }
}
