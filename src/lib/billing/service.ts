import { errorMessage } from '../shared/errors.js'
import type { BillingPlan, BillingUsageMeter } from '../api/types.js'
import {
  type BillingSubscriptionManifest,
  type BillingSubscriptionPlan,
  type BillingUsageManifest,
  type BillingUsageMeterDefinition,
  type BillingUsageTierDefinition,
  buildBillingSubscriptionManifest,
  buildBillingUsageManifest,
  toBillingMeterCreateBody,
  toBillingMeterUpdateBody,
  toBillingPlanCreateBody
} from './manifest.js'
import {
  type BillingSubscriptionOperation,
  type BillingSubscriptionSyncPlan,
  type BillingUsageOperation,
  type BillingUsageSyncPlan
} from './sync.js'
import { valuesEqual } from '../shared/three-way-diff.js'

export interface BillingReadApi {
  getBillingPlans(appId: string): Promise<BillingPlan[]>
  getBillingUsageMeters(appId: string): Promise<BillingUsageMeter[]>
}

export interface BillingMutationApi {
  addBillingPlan(appId: string, body: unknown): Promise<unknown>
  updateBillingPlan(appId: string, planId: string, body: unknown): Promise<unknown>
  deleteBillingPlan(appId: string, planId: string): Promise<void>
  addBillingUsageMeter(appId: string, body: unknown): Promise<unknown>
  updateBillingUsageTier(appId: string, meterId: string, tierId: string, body: unknown): Promise<unknown>
  deleteBillingUsageTier(appId: string, meterId: string, tierId: string): Promise<void>
  deleteBillingUsageMeter(appId: string, meterId: string): Promise<void>
}

export interface BillingSnapshot {
  subscriptions: BillingSubscriptionManifest
  usage: BillingUsageManifest
}

export interface BillingOperationResult {
  operation: string
  resource: 'subscription' | 'usage'
  success: boolean
  error?: string
}

export interface BillingExecutionResult {
  total: number
  succeeded: number
  failed: number
  applied: string[]
  results: BillingOperationResult[]
}

function withoutId<T extends { id?: string }>(value: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = value
  return rest
}

export async function fetchBillingSnapshot(client: BillingReadApi, appId: string): Promise<BillingSnapshot> {
  const [plans, meters] = await Promise.all([client.getBillingPlans(appId), client.getBillingUsageMeters(appId)])
  return {
    subscriptions: buildBillingSubscriptionManifest(appId, plans),
    usage: buildBillingUsageManifest(appId, meters)
  }
}

export function billingSubscriptionOperationLabel(operation: BillingSubscriptionOperation): string {
  if (operation.type === 'create-plan') return `create-plan:${operation.desired.name}`
  return `${operation.type}:${operation.planId}`
}

export function billingUsageOperationLabel(operation: BillingUsageOperation): string {
  if (operation.type === 'create-meter') {
    return `create-meter:${operation.desired.productId}:${operation.desired.direction ?? ''}`
  }
  if (operation.type === 'delete-meter') return `delete-meter:${operation.meterId}`
  if (operation.type === 'create-tier') return `create-tier:${operation.meterId}:${operation.desiredTier.name}`
  return `${operation.type}:${operation.meterId}:${operation.tierId}`
}

function assertExecutablePlans(subscriptions: BillingSubscriptionSyncPlan, usage: BillingUsageSyncPlan): void {
  const errors = [...subscriptions.errors, ...usage.errors]
  const conflicts = [...subscriptions.conflicts, ...usage.conflicts]
  if (errors.length > 0) throw new Error(`Billing push is invalid:\n- ${errors.join('\n- ')}`)
  if (conflicts.length > 0) {
    throw new Error(
      `Billing push has portal conflicts:\n- ${conflicts.join('\n- ')}\nPull and reapply the local changes.`
    )
  }
}

async function executeSubscriptionOperation(
  client: BillingMutationApi,
  appId: string,
  operation: BillingSubscriptionOperation
): Promise<void> {
  if (operation.type === 'create-plan') {
    await client.addBillingPlan(appId, toBillingPlanCreateBody(operation.desired))
    return
  }
  if (operation.type === 'update-plan') {
    await client.updateBillingPlan(appId, operation.planId, toBillingPlanCreateBody(operation.desired))
    return
  }
  await client.deleteBillingPlan(appId, operation.planId)
}

async function executeUsageOperation(
  client: BillingMutationApi,
  appId: string,
  operation: BillingUsageOperation
): Promise<void> {
  if (operation.type === 'create-meter') {
    for (const tier of operation.desired.tiers) {
      await client.addBillingUsageMeter(appId, toBillingMeterCreateBody(operation.desired, tier))
    }
    return
  }
  if (operation.type === 'create-tier') {
    await client.addBillingUsageMeter(appId, toBillingMeterCreateBody(operation.desiredMeter, operation.desiredTier))
    return
  }
  if (operation.type === 'update-tier') {
    await client.updateBillingUsageTier(
      appId,
      operation.meterId,
      operation.tierId,
      toBillingMeterUpdateBody(operation.desiredMeter, operation.desiredTier)
    )
    return
  }
  if (operation.type === 'delete-tier') {
    await client.deleteBillingUsageTier(appId, operation.meterId, operation.tierId)
    return
  }
  await client.deleteBillingUsageMeter(appId, operation.meterId)
}

export async function executeBillingSyncPlans(
  client: BillingMutationApi,
  subscriptions: BillingSubscriptionSyncPlan,
  usage: BillingUsageSyncPlan
): Promise<BillingExecutionResult> {
  assertExecutablePlans(subscriptions, usage)
  const results: BillingOperationResult[] = []
  for (const operation of subscriptions.operations) {
    const label = billingSubscriptionOperationLabel(operation)
    try {
      await executeSubscriptionOperation(client, subscriptions.appId, operation)
      results.push({ operation: label, resource: 'subscription', success: true })
    } catch (error) {
      results.push({
        operation: label,
        resource: 'subscription',
        success: false,
        error: errorMessage(error, 'Subscription billing operation failed.')
      })
    }
  }
  for (const operation of usage.operations) {
    const label = billingUsageOperationLabel(operation)
    try {
      await executeUsageOperation(client, usage.appId, operation)
      results.push({ operation: label, resource: 'usage', success: true })
    } catch (error) {
      results.push({
        operation: label,
        resource: 'usage',
        success: false,
        error: errorMessage(error, 'Usage-based billing operation failed.')
      })
    }
  }
  const applied = results.filter(result => result.success).map(result => result.operation)
  return {
    total: results.length,
    succeeded: applied.length,
    failed: results.length - applied.length,
    applied,
    results
  }
}

function planMatches(desired: BillingSubscriptionPlan, current: BillingSubscriptionPlan): boolean {
  return valuesEqual(withoutId(desired), withoutId(current))
}

function tierMatches(desired: BillingUsageTierDefinition, current: BillingUsageTierDefinition): boolean {
  return valuesEqual(withoutId(desired), withoutId(current))
}

function meterSharedMatches(desired: BillingUsageMeterDefinition, current: BillingUsageMeterDefinition): boolean {
  const { tiers: _desiredTiers, ...desiredShared } = withoutId(desired)
  const { tiers: _currentTiers, ...currentShared } = withoutId(current)
  return valuesEqual(desiredShared, currentShared)
}

function meterMatches(desired: BillingUsageMeterDefinition, current: BillingUsageMeterDefinition): boolean {
  if (!meterSharedMatches(desired, current) || desired.tiers.length !== current.tiers.length) return false
  return desired.tiers.every(tier => current.tiers.some(remoteTier => tierMatches(tier, remoteTier)))
}

export function verifyBillingOperations(
  subscriptions: BillingSubscriptionSyncPlan,
  usage: BillingUsageSyncPlan,
  remote: BillingSnapshot
): string[] {
  const mismatches: string[] = []
  for (const operation of subscriptions.operations) {
    const current =
      operation.type === 'create-plan'
        ? remote.subscriptions.plans.find(plan => planMatches(operation.desired, plan))
        : remote.subscriptions.plans.find(plan => plan.id === operation.planId)
    const matches =
      operation.type === 'delete-plan' ? !current : Boolean(current && planMatches(operation.desired, current))
    if (!matches) mismatches.push(billingSubscriptionOperationLabel(operation))
  }
  for (const operation of usage.operations) {
    const meter =
      operation.type === 'create-meter'
        ? remote.usage.meters.find(
            item => item.productId === operation.desired.productId && item.direction === operation.desired.direction
          )
        : remote.usage.meters.find(item => item.id === operation.meterId)
    let matches: boolean
    if (operation.type === 'create-meter') matches = Boolean(meter && meterMatches(operation.desired, meter))
    else if (operation.type === 'delete-meter') matches = !meter
    else if (operation.type === 'delete-tier')
      matches = Boolean(meter && !meter.tiers.some(tier => tier.id === operation.tierId))
    else if (operation.type === 'create-tier') {
      matches = Boolean(
        meter &&
        meterSharedMatches(operation.desiredMeter, meter) &&
        meter.tiers.some(tier => tierMatches(operation.desiredTier, tier))
      )
    } else {
      const tier = meter?.tiers.find(item => item.id === operation.tierId)
      matches = Boolean(
        meter && tier && meterSharedMatches(operation.desiredMeter, meter) && tierMatches(operation.desiredTier, tier)
      )
    }
    if (!matches) mismatches.push(billingUsageOperationLabel(operation))
  }
  return mismatches
}

function replacePlan(plans: BillingSubscriptionPlan[], desired: BillingSubscriptionPlan): void {
  const index = plans.findIndex(plan => plan.id === desired.id)
  if (index >= 0) plans[index] = structuredClone(desired)
  else plans.push(structuredClone(desired))
}

function replaceMeter(meters: BillingUsageMeterDefinition[], desired: BillingUsageMeterDefinition): void {
  const index = meters.findIndex(meter => meter.id === desired.id)
  if (index >= 0) meters[index] = structuredClone(desired)
  else meters.push(structuredClone(desired))
}

function reconcileFailedSubscription(
  local: BillingSubscriptionManifest,
  reconciled: BillingSubscriptionManifest,
  operation: BillingSubscriptionOperation
): void {
  if (operation.type === 'create-plan') {
    if (!reconciled.plans.some(plan => planMatches(operation.desired, plan))) {
      reconciled.plans.push(structuredClone(operation.desired))
    }
    return
  }
  if (operation.type === 'delete-plan') {
    reconciled.plans = reconciled.plans.filter(plan => plan.id !== operation.planId)
    return
  }
  const desired = local.plans.find(plan => plan.id === operation.planId) ?? operation.desired
  replacePlan(reconciled.plans, desired)
}

function reconcileFailedUsage(
  local: BillingUsageManifest,
  reconciled: BillingUsageManifest,
  operation: BillingUsageOperation
): void {
  if (operation.type === 'create-meter') {
    const partial = reconciled.meters.find(
      meter => meter.productId === operation.desired.productId && meter.direction === operation.desired.direction
    )
    if (!partial) {
      reconciled.meters.push(structuredClone(operation.desired))
      return
    }
    const desired = structuredClone(operation.desired)
    desired.id = partial.id
    for (const tier of desired.tiers) {
      const remoteTier = partial.tiers.find(item => tierMatches(tier, item))
      if (remoteTier) tier.id = remoteTier.id
    }
    replaceMeter(reconciled.meters, desired)
    return
  }
  if (operation.type === 'delete-meter') {
    reconciled.meters = reconciled.meters.filter(meter => meter.id !== operation.meterId)
    return
  }
  const meter = reconciled.meters.find(item => item.id === operation.meterId)
  const desiredLocal = local.meters.find(item => item.id === operation.meterId)
  if (!meter || !desiredLocal) return
  meter.productName = desiredLocal.productName
  meter.usageUnit = desiredLocal.usageUnit
  if (desiredLocal.pricingPageUrl) meter.pricingPageUrl = desiredLocal.pricingPageUrl
  else delete meter.pricingPageUrl
  if (operation.type === 'create-tier') {
    if (!meter.tiers.some(tier => tierMatches(operation.desiredTier, tier))) {
      meter.tiers.push(structuredClone(operation.desiredTier))
    }
  } else if (operation.type === 'delete-tier') {
    meter.tiers = meter.tiers.filter(tier => tier.id !== operation.tierId)
  } else {
    const desiredTier = desiredLocal.tiers.find(tier => tier.id === operation.tierId) ?? operation.desiredTier
    const index = meter.tiers.findIndex(tier => tier.id === operation.tierId)
    if (index >= 0) meter.tiers[index] = structuredClone(desiredTier)
    else meter.tiers.push(structuredClone(desiredTier))
  }
}

export function reconcileBillingAfterPush(
  local: BillingSnapshot,
  remote: BillingSnapshot,
  subscriptions: BillingSubscriptionSyncPlan,
  usage: BillingUsageSyncPlan,
  failedOperations: Set<string>
): BillingSnapshot {
  const reconciled = structuredClone(remote)
  for (const operation of subscriptions.operations) {
    if (failedOperations.has(billingSubscriptionOperationLabel(operation))) {
      reconcileFailedSubscription(local.subscriptions, reconciled.subscriptions, operation)
    }
  }
  for (const operation of usage.operations) {
    if (failedOperations.has(billingUsageOperationLabel(operation))) {
      reconcileFailedUsage(local.usage, reconciled.usage, operation)
    }
  }
  reconciled.subscriptions.plans.sort((left, right) => (left.id ?? left.name).localeCompare(right.id ?? right.name))
  reconciled.usage.meters.sort((left, right) =>
    (left.id ?? `${left.productId}:${left.direction ?? ''}`).localeCompare(
      right.id ?? `${right.productId}:${right.direction ?? ''}`
    )
  )
  return reconciled
}
