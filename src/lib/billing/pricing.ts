import type { BillingSettings } from '../api/types.js'
import { normalizeStatus } from '../app/rules.js'
import { validateHttpsUrl, validatePositiveInteger, validateTextForWhiteLabel } from '../shared/validation.js'

interface BillingSettingsInput {
  model: BillingSettings['billingType']
  externalBillingUrl?: string
  trialDays?: number
  isTemplateApp?: boolean
  createdAt?: string
}

interface BillingPlanInput {
  name: string
  free: boolean
  amount?: number
  locationAmount?: number
  interval: 'month' | 'year' | 'life_time'
  features?: string[]
  model?: BillingSettings['billingType']
  isTemplateApp?: boolean
  isWhiteLabelFriendly?: boolean
  allowLocationPricing?: boolean
}

/* Portal limits (marketplace-frontend PricingV2/AddEditPlanModalV2). */
export const MAX_PLANS = 6
export const MAX_TEMPLATE_PLANS = 1
export const MAX_PLAN_FEATURES = 5
export const EXTERNAL_BILLING_CUTOFF = new Date('2026-06-17T00:00:00.000Z')

/* Statuses whose pricing the portal locks entirely (radios, plan actions,
   and save are all disabled while the version is one of these). */
export function requirePricingEditable(status: string | undefined): void {
  if (!status) throw new Error('Cannot edit pricing: the selected version status is unavailable.')
  if (['inreview', 'review', 'live', 'deprecated'].includes(normalizeStatus(status))) {
    throw new Error(
      `Pricing cannot be changed while the version is ${status} — the portal only allows pricing edits on draft or disapproved versions.`
    )
  }
}

export function parseAmount(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label} must be a valid amount: non-negative with at most two decimal places.`)
  }
  const amount = Number(normalized)
  if (!Number.isFinite(amount)) throw new Error(`${label} must be a valid amount.`)
  return amount
}

export function buildBillingSettings(input: BillingSettingsInput): BillingSettings {
  const externalBillingUrl = input.externalBillingUrl?.trim() ?? ''
  if (input.isTemplateApp && input.model === 'freemium') {
    throw new Error('Template apps cannot use the freemium model.')
  }
  if (externalBillingUrl && input.model !== 'paid') {
    throw new Error('External billing is only available for paid apps.')
  }
  if (externalBillingUrl && input.isTemplateApp) {
    throw new Error('External billing is not available for template apps.')
  }
  if (externalBillingUrl && input.createdAt) {
    const createdAt = new Date(input.createdAt)
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('App creation date is invalid; pull the app again before editing billing.')
    }
    if (createdAt > EXTERNAL_BILLING_CUTOFF) {
      throw new Error('External billing is not available for apps created after June 17, 2026.')
    }
  }
  if (input.trialDays !== undefined && input.model === 'free') {
    throw new Error('Free trials are only available for paid or freemium apps.')
  }
  if (input.trialDays !== undefined && input.isTemplateApp) {
    throw new Error('Free trials are not available for template apps.')
  }
  if (input.trialDays !== undefined && externalBillingUrl) {
    throw new Error('Free trials are not available when external billing is enabled.')
  }
  if (externalBillingUrl) {
    const result = validateHttpsUrl(externalBillingUrl, 'External billing URL', { publicOnly: true })
    if (result !== true) throw new Error(result)
  }
  if (input.trialDays !== undefined) {
    const result = validatePositiveInteger(input.trialDays, 'Trial days', { min: 1, max: 90 })
    if (result !== true) throw new Error(result)
  }
  return {
    billingType: input.model,
    externalBilling: Boolean(externalBillingUrl),
    /* The portal stores the URL without a scheme (its https:// prefix is
       UI-only), so strip it to keep the stored value portal-compatible. */
    externalBillingUrl: externalBillingUrl.replace(/^https:\/\//, ''),
    hasFreeTrial: input.trialDays !== undefined,
    freeTrialDuration: input.trialDays
  }
}

export function buildBillingPlan(input: BillingPlanInput) {
  const name = input.name.trim()
  if (!name) throw new Error('Plan name is required.')
  if (input.isWhiteLabelFriendly) {
    const nameCheck = validateTextForWhiteLabel(name, 'Plan name')
    if (nameCheck !== true) throw new Error(nameCheck)
  }
  if (input.free && input.model !== undefined && input.model !== 'freemium') {
    throw new Error(
      'Free plans are only available for freemium apps — set the model first: `ghl app pricing setup --model freemium`.'
    )
  }
  if (input.free && (input.amount !== undefined || input.locationAmount !== undefined)) {
    throw new Error('Do not pass --amount or --location-amount with --free.')
  }
  if (input.isTemplateApp && input.interval !== 'life_time') {
    throw new Error('Template apps only support one-time pricing (--interval life_time).')
  }
  if (input.locationAmount !== undefined && input.allowLocationPricing === false) {
    throw new Error('Sub-account pricing is only available when the app targets both agencies and sub-accounts.')
  }
  if (!input.free) {
    if (input.amount === undefined || input.amount < 0.01) throw new Error('Paid plan amount must be at least 0.01.')
    if (input.locationAmount !== undefined && input.locationAmount < 0.01) {
      throw new Error('Paid plan location amount must be at least 0.01.')
    }
  }
  const features = (input.features ?? []).map(feature => feature.trim())
  if (features.some(feature => !feature)) throw new Error('Plan features cannot be blank.')
  if (features.length > MAX_PLAN_FEATURES)
    throw new Error(`A pricing plan can have at most ${MAX_PLAN_FEATURES} features.`)
  if (input.isWhiteLabelFriendly) {
    for (const feature of features) {
      const check = validateTextForWhiteLabel(feature, `Plan feature "${feature}"`)
      if (check !== true) throw new Error(check)
    }
  }
  return {
    name,
    freePlan: input.free,
    freeForAgency: input.free,
    freeForLocation: input.free,
    amount: input.free ? 0 : input.amount,
    ...(input.free
      ? { locationAmount: 0 }
      : input.locationAmount !== undefined
        ? { locationAmount: input.locationAmount }
        : {}),
    features,
    paymentTime: input.interval,
    paymentType: input.interval === 'life_time' ? 'one_time' : 'recurring'
  }
}

/* The portal auto-creates this plan when a developer switches to freemium. */
export function defaultFreePlan(isTemplateApp: boolean) {
  return {
    name: 'Free Plan',
    freePlan: true,
    freeForAgency: true,
    freeForLocation: true,
    amount: 0,
    locationAmount: 0,
    features: [] as string[],
    paymentTime: isTemplateApp ? 'life_time' : 'month',
    paymentType: isTemplateApp ? 'one_time' : 'recurring'
  }
}

export function isFreePlanEntry(plan: {
  freePlan?: boolean
  isFreemiumPlan?: boolean
  freeForAgency?: boolean
  freeForLocation?: boolean
}): boolean {
  return Boolean(plan.freePlan ?? plan.isFreemiumPlan ?? (plan.freeForAgency && plan.freeForLocation))
}
