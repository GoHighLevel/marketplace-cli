import {
  type BillingSubscriptionManifest,
  type BillingSubscriptionPlan,
  type BillingUsageManifest,
  type BillingUsageMeterDefinition,
  type BillingUsageTierDefinition
} from './manifest.js'
import { applyValueChanges, changedValuePaths, valuePathsOverlap, valuesEqual } from '../shared/three-way-diff.js'

export type BillingSubscriptionOperation =
  | { type: 'create-plan'; desired: BillingSubscriptionPlan }
  | { type: 'update-plan'; planId: string; desired: BillingSubscriptionPlan; current: BillingSubscriptionPlan }
  | { type: 'delete-plan'; planId: string; current: BillingSubscriptionPlan }

export interface BillingSubscriptionSyncPlan {
  appId: string
  localChanges: string[]
  remoteChanges: string[]
  conflicts: string[]
  errors: string[]
  operations: BillingSubscriptionOperation[]
}

export type BillingUsageOperation =
  | { type: 'create-meter'; desired: BillingUsageMeterDefinition }
  | {
      type: 'create-tier'
      meterId: string
      desiredMeter: BillingUsageMeterDefinition
      desiredTier: BillingUsageTierDefinition
    }
  | {
      type: 'update-tier'
      meterId: string
      tierId: string
      desiredMeter: BillingUsageMeterDefinition
      desiredTier: BillingUsageTierDefinition
      currentTier: BillingUsageTierDefinition
    }
  | { type: 'delete-tier'; meterId: string; tierId: string; currentTier: BillingUsageTierDefinition }
  | { type: 'delete-meter'; meterId: string; current: BillingUsageMeterDefinition }

export interface BillingUsageSyncPlan {
  appId: string
  localChanges: string[]
  remoteChanges: string[]
  conflicts: string[]
  errors: string[]
  operations: BillingUsageOperation[]
}

const IMMUTABLE_PLAN_FIELDS = new Set([
  'amount',
  'locationAmount',
  'paymentTime',
  'paymentType',
  'freePlan',
  'freeForAgency',
  'freeForLocation'
])
const IMMUTABLE_METER_FIELDS = new Set(['productType', 'productId', 'direction', 'customPriceType'])

function byOptionalId<T extends { id?: string }>(items: T[]): Map<string, T> {
  return new Map(items.filter(item => item.id).map(item => [item.id as string, item]))
}

function withoutId<T extends { id?: string }>(value: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = value
  return rest
}

function planChanges(base: BillingSubscriptionManifest, value: BillingSubscriptionManifest): string[] {
  const baseById = byOptionalId(base.plans)
  const valueById = byOptionalId(value.plans)
  const changes: string[] = []
  for (const id of [...new Set([...baseById.keys(), ...valueById.keys()])].sort()) {
    const before = baseById.get(id)
    const after = valueById.get(id)
    if (!before || !after) changes.push(`plans.${id}`)
    else changes.push(...changedValuePaths(before, after, `plans.${id}`))
  }
  value.plans
    .filter(plan => !plan.id)
    .forEach((plan, index) => {
      changes.push(`plans.new[${index}]:${plan.name}`)
    })
  return changes
}

function assertAppBindings(
  baseline: { appId: string },
  local: { appId: string },
  remote: { appId: string },
  errors: string[]
): boolean {
  if (baseline.appId === local.appId && baseline.appId === remote.appId) return true
  errors.push('Billing app bindings do not match; pull the app again before pushing.')
  return false
}

export function planBillingSubscriptionSync(
  baseline: BillingSubscriptionManifest,
  local: BillingSubscriptionManifest,
  remote: BillingSubscriptionManifest
): BillingSubscriptionSyncPlan {
  const plan: BillingSubscriptionSyncPlan = {
    appId: local.appId,
    localChanges: planChanges(baseline, local),
    remoteChanges: planChanges(baseline, remote),
    conflicts: [],
    errors: [],
    operations: []
  }
  if (!assertAppBindings(baseline, local, remote, plan.errors)) return plan

  const baselineById = byOptionalId(baseline.plans)
  const localById = byOptionalId(local.plans)
  const remoteById = byOptionalId(remote.plans)
  for (const localPlan of local.plans.filter(item => !item.id)) {
    const replaced = baseline.plans.find(item => item.name.toLowerCase() === localPlan.name.toLowerCase())
    if (replaced && valuesEqual(withoutId(replaced), withoutId(localPlan))) {
      plan.errors.push(`plans.${replaced.id}.id is immutable; omit the plan only when replacing it intentionally.`)
      continue
    }
    const remoteCollision = remote.plans.find(
      item => !baselineById.has(item.id as string) && item.name.toLowerCase() === localPlan.name.toLowerCase()
    )
    if (remoteCollision) plan.conflicts.push(`plans.new:${localPlan.name}`)
    else plan.operations.push({ type: 'create-plan', desired: localPlan })
  }

  for (const [id, base] of baselineById) {
    const desired = localById.get(id)
    const current = remoteById.get(id)
    const path = `plans.${id}`
    if (!desired) {
      if (!current) continue
      if (!valuesEqual(base, current)) plan.conflicts.push(path)
      else plan.operations.push({ type: 'delete-plan', planId: id, current })
      continue
    }
    if (!current) {
      if (!valuesEqual(base, desired)) plan.conflicts.push(path)
      continue
    }
    const localPaths = changedValuePaths(withoutId(base), withoutId(desired))
    for (const field of localPaths.filter(field => IMMUTABLE_PLAN_FIELDS.has(field))) {
      plan.errors.push(`${path}.${field} is immutable after plan creation; create a new plan instead.`)
    }
    const editableLocal = localPaths.filter(field => !IMMUTABLE_PLAN_FIELDS.has(field))
    if (editableLocal.length === 0) continue
    const remotePaths = changedValuePaths(withoutId(base), withoutId(current))
    const conflicts = editableLocal.filter(localPath =>
      remotePaths.some(remotePath => valuePathsOverlap(localPath, remotePath))
    )
    if (conflicts.length > 0) {
      plan.conflicts.push(...conflicts.map(field => `${path}.${field}`))
      continue
    }
    const desiredMerged = applyValueChanges(
      withoutId(current) as Record<string, unknown>,
      withoutId(desired) as Record<string, unknown>,
      editableLocal
    ) as unknown as Omit<BillingSubscriptionPlan, 'id'>
    plan.operations.push({
      type: 'update-plan',
      planId: id,
      desired: { id, ...desiredMerged },
      current
    })
  }

  for (const localPlan of local.plans.filter(item => item.id && !baselineById.has(item.id))) {
    if (!remoteById.has(localPlan.id as string)) {
      plan.errors.push(`plans.${localPlan.id}.id is unknown; omit id when creating a local plan.`)
    }
  }
  return finalizeSubscriptionPlan(plan)
}

function finalizeSubscriptionPlan(plan: BillingSubscriptionSyncPlan): BillingSubscriptionSyncPlan {
  plan.localChanges = [...new Set(plan.localChanges)].sort()
  plan.remoteChanges = [...new Set(plan.remoteChanges)].sort()
  plan.conflicts = [...new Set(plan.conflicts)].sort()
  plan.errors = [...new Set(plan.errors)].sort()
  if (plan.conflicts.length > 0 || plan.errors.length > 0) plan.operations = []
  else {
    const priority = { 'update-plan': 0, 'delete-plan': 1, 'create-plan': 2 } as const
    plan.operations.sort((left, right) => priority[left.type] - priority[right.type])
  }
  return plan
}

function meterKey(meter: BillingUsageMeterDefinition): string {
  return meter.id ?? `new:${meter.productId}:${meter.direction ?? ''}`
}

function meterChanges(base: BillingUsageManifest, value: BillingUsageManifest): string[] {
  const baseById = byOptionalId(base.meters)
  const valueById = byOptionalId(value.meters)
  const changes: string[] = []
  for (const id of [...new Set([...baseById.keys(), ...valueById.keys()])].sort()) {
    const before = baseById.get(id)
    const after = valueById.get(id)
    if (!before || !after) {
      changes.push(`meters.${id}`)
      continue
    }
    const beforeShared = { ...withoutId(before), tiers: undefined }
    const afterShared = { ...withoutId(after), tiers: undefined }
    changes.push(...changedValuePaths(beforeShared, afterShared, `meters.${id}`))
    const beforeTiers = byOptionalId(before.tiers)
    const afterTiers = byOptionalId(after.tiers)
    for (const tierId of [...new Set([...beforeTiers.keys(), ...afterTiers.keys()])].sort()) {
      const beforeTier = beforeTiers.get(tierId)
      const afterTier = afterTiers.get(tierId)
      if (!beforeTier || !afterTier) changes.push(`meters.${id}.tiers.${tierId}`)
      else changes.push(...changedValuePaths(beforeTier, afterTier, `meters.${id}.tiers.${tierId}`))
    }
    after.tiers
      .filter(tier => !tier.id)
      .forEach((tier, index) => {
        changes.push(`meters.${id}.tiers.new[${index}]:${tier.name}`)
      })
  }
  value.meters.filter(meter => !meter.id).forEach(meter => changes.push(`meters.${meterKey(meter)}`))
  return changes
}

function sharedMeter(meter: BillingUsageMeterDefinition): Omit<BillingUsageMeterDefinition, 'id' | 'tiers'> {
  const { id: _id, tiers: _tiers, ...shared } = meter
  return shared
}

function addExistingMeterOperations(
  base: BillingUsageMeterDefinition,
  local: BillingUsageMeterDefinition,
  remote: BillingUsageMeterDefinition,
  plan: BillingUsageSyncPlan
): void {
  const id = base.id as string
  const path = `meters.${id}`
  const localSharedPaths = changedValuePaths(sharedMeter(base), sharedMeter(local))
  for (const field of localSharedPaths.filter(field => IMMUTABLE_METER_FIELDS.has(field))) {
    plan.errors.push(`${path}.${field} is immutable; create a new meter instead.`)
  }
  const editableShared = localSharedPaths.filter(field => !IMMUTABLE_METER_FIELDS.has(field))
  const remoteSharedPaths = changedValuePaths(sharedMeter(base), sharedMeter(remote))
  const sharedConflicts = editableShared.filter(localPath =>
    remoteSharedPaths.some(remotePath => valuePathsOverlap(localPath, remotePath))
  )
  if (sharedConflicts.length > 0) {
    plan.conflicts.push(...sharedConflicts.map(field => `${path}.${field}`))
    return
  }
  const mergedShared = applyValueChanges(
    sharedMeter(remote) as Record<string, unknown>,
    sharedMeter(local) as Record<string, unknown>,
    editableShared
  ) as unknown as Omit<BillingUsageMeterDefinition, 'id' | 'tiers'>
  const desiredMeter = { id, ...mergedShared, tiers: remote.tiers } as BillingUsageMeterDefinition
  const baseTiers = byOptionalId(base.tiers)
  const localTiers = byOptionalId(local.tiers)
  const remoteTiers = byOptionalId(remote.tiers)
  let sharedUpdatePlanned = false

  for (const tier of local.tiers.filter(item => !item.id)) {
    plan.operations.push({ type: 'create-tier', meterId: id, desiredMeter, desiredTier: tier })
  }
  for (const tier of local.tiers.filter(item => item.id && !baseTiers.has(item.id))) {
    if (!remoteTiers.has(tier.id as string)) {
      plan.errors.push(`${path}.tiers.${tier.id}.id is unknown; omit id when creating a local tier.`)
    }
  }
  for (const [tierId, baseTier] of baseTiers) {
    const desiredTier = localTiers.get(tierId)
    const currentTier = remoteTiers.get(tierId)
    const tierPath = `${path}.tiers.${tierId}`
    if (!desiredTier) {
      if (!currentTier) continue
      if (!valuesEqual(baseTier, currentTier)) plan.conflicts.push(tierPath)
      else plan.operations.push({ type: 'delete-tier', meterId: id, tierId, currentTier })
      continue
    }
    if (!currentTier) {
      if (!valuesEqual(baseTier, desiredTier)) plan.conflicts.push(tierPath)
      continue
    }
    const localTierPaths = changedValuePaths(withoutId(baseTier), withoutId(desiredTier))
    const remoteTierPaths = changedValuePaths(withoutId(baseTier), withoutId(currentTier))
    const tierConflicts = localTierPaths.filter(localPath =>
      remoteTierPaths.some(remotePath => valuePathsOverlap(localPath, remotePath))
    )
    if (tierConflicts.length > 0) {
      plan.conflicts.push(...tierConflicts.map(field => `${tierPath}.${field}`))
      continue
    }
    if (localTierPaths.length === 0 && (editableShared.length === 0 || sharedUpdatePlanned)) continue
    const mergedTier = applyValueChanges(
      withoutId(currentTier) as Record<string, unknown>,
      withoutId(desiredTier) as Record<string, unknown>,
      localTierPaths
    ) as unknown as Omit<BillingUsageTierDefinition, 'id'>
    plan.operations.push({
      type: 'update-tier',
      meterId: id,
      tierId,
      desiredMeter,
      desiredTier: { id: tierId, ...mergedTier },
      currentTier
    })
    sharedUpdatePlanned = true
  }
  if (editableShared.length > 0 && !sharedUpdatePlanned) {
    const currentTier = remote.tiers.find(tier => tier.id)
    if (!currentTier) plan.conflicts.push(`${path}.tiers`)
    else {
      plan.operations.push({
        type: 'update-tier',
        meterId: id,
        tierId: currentTier.id as string,
        desiredMeter,
        desiredTier: currentTier,
        currentTier
      })
    }
  }
}

export function planBillingUsageSync(
  baseline: BillingUsageManifest,
  local: BillingUsageManifest,
  remote: BillingUsageManifest
): BillingUsageSyncPlan {
  const plan: BillingUsageSyncPlan = {
    appId: local.appId,
    localChanges: meterChanges(baseline, local),
    remoteChanges: meterChanges(baseline, remote),
    conflicts: [],
    errors: [],
    operations: []
  }
  if (!assertAppBindings(baseline, local, remote, plan.errors)) return plan
  const baselineById = byOptionalId(baseline.meters)
  const localById = byOptionalId(local.meters)
  const remoteById = byOptionalId(remote.meters)

  for (const meter of local.meters.filter(item => !item.id)) {
    const collision = remote.meters.find(
      current =>
        !baselineById.has(current.id as string) &&
        current.productId === meter.productId &&
        current.direction === meter.direction
    )
    if (collision) plan.conflicts.push(`meters.${meterKey(meter)}`)
    else plan.operations.push({ type: 'create-meter', desired: meter })
  }
  for (const meter of local.meters.filter(item => item.id && !baselineById.has(item.id))) {
    if (!remoteById.has(meter.id as string)) {
      plan.errors.push(`meters.${meter.id}.id is unknown; omit id when creating a local meter.`)
    }
  }
  for (const [id, base] of baselineById) {
    const desired = localById.get(id)
    const current = remoteById.get(id)
    const path = `meters.${id}`
    if (!desired) {
      if (!current) continue
      if (!valuesEqual(base, current)) plan.conflicts.push(path)
      else plan.operations.push({ type: 'delete-meter', meterId: id, current })
      continue
    }
    if (!current) {
      if (!valuesEqual(base, desired)) plan.conflicts.push(path)
      continue
    }
    addExistingMeterOperations(base, desired, current, plan)
  }
  return finalizeUsagePlan(plan)
}

function finalizeUsagePlan(plan: BillingUsageSyncPlan): BillingUsageSyncPlan {
  plan.localChanges = [...new Set(plan.localChanges)].sort()
  plan.remoteChanges = [...new Set(plan.remoteChanges)].sort()
  plan.conflicts = [...new Set(plan.conflicts)].sort()
  plan.errors = [...new Set(plan.errors)].sort()
  if (plan.conflicts.length > 0 || plan.errors.length > 0) plan.operations = []
  else {
    const priority = {
      'update-tier': 0,
      'delete-tier': 1,
      'delete-meter': 2,
      'create-tier': 3,
      'create-meter': 4
    } as const
    plan.operations.sort((left, right) => priority[left.type] - priority[right.type])
  }
  return plan
}
