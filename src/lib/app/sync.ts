import { type AppVersion } from '../api/client.js'
import { isRecord } from '../api/response.js'
import { type AppFiles } from './manifest.js'
import { isAppResourceIdentifier, validateAppWorkspaceSchema } from './schema.js'
import { type WorkspaceState } from './workspace.js'
import { requireVersionStatus } from './rules.js'
import { requireAuthPrereqs } from '../auth/settings.js'
import { buildBillingSettings, requirePricingEditable } from '../billing/pricing.js'
import {
  buildBasicInfoBody,
  buildProfilesBody,
  buildReviewDetailsBody,
  buildSupportBody,
  validateBasicInfoBody,
  validateProfilesBody,
  validateReviewDetailsBody,
  validateReviewDetailsChanges,
  validateSupportBody
} from './profile-sections.js'

export type PushSection =
  | 'listing'
  | 'basicInfo'
  | 'profiles'
  | 'support'
  | 'authSettings'
  | 'defaultRedirect'
  | 'defaultClientKey'
  | 'review'
  | 'billing'

export const PUSH_SECTION_ORDER: PushSection[] = [
  'listing',
  'basicInfo',
  'profiles',
  'support',
  'authSettings',
  'defaultRedirect',
  'defaultClientKey',
  'review',
  'billing'
]

export interface AppSyncChange {
  path: string
  section: PushSection | 'readOnly'
  baseline: unknown
  local: unknown
  remote: unknown
}

export interface AppSyncPlan {
  appId: string
  versionId: string
  desired: AppFiles
  localChanges: AppSyncChange[]
  remoteChanges: AppSyncChange[]
  conflicts: AppSyncChange[]
  sections: PushSection[]
}

export interface AppWorkspaceValidation {
  errors: string[]
  sections: PushSection[]
}

interface FieldSpec {
  path: string
  section: PushSection
  setLike?: boolean
}

const FIELD_SPECS: FieldSpec[] = [
  { path: 'basicInfo.name', section: 'basicInfo' },
  { path: 'basicInfo.tagline', section: 'basicInfo' },
  { path: 'basicInfo.companyName', section: 'basicInfo' },
  { path: 'basicInfo.website', section: 'basicInfo' },
  { path: 'basicInfo.subcategory', section: 'basicInfo', setLike: true },
  { path: 'basicInfo.businessNiche', section: 'basicInfo', setLike: true },
  { path: 'basicInfo.logoUrl', section: 'basicInfo' },
  { path: 'listing.private', section: 'listing' },
  { path: 'listing.userTypes', section: 'listing', setLike: true },
  { path: 'listing.isWhiteLabelFriendly', section: 'listing' },
  { path: 'listing.isAgencyBulkInstallEnabled', section: 'listing' },
  { path: 'listing.searchKeywords', section: 'listing', setLike: true },
  { path: 'profiles.agency.description', section: 'profiles' },
  { path: 'profiles.agency.previewImageUrls', section: 'profiles' },
  { path: 'profiles.agency.previewVideoUrl', section: 'profiles' },
  { path: 'profiles.subAccount.enabled', section: 'profiles' },
  { path: 'profiles.subAccount.description', section: 'profiles' },
  { path: 'profiles.subAccount.previewImageUrls', section: 'profiles' },
  { path: 'profiles.subAccount.previewVideoUrl', section: 'profiles' },
  { path: 'oauth.allowedScopes', section: 'authSettings', setLike: true },
  { path: 'oauth.redirectUris', section: 'authSettings', setLike: true },
  { path: 'oauth.defaults.redirectUrl', section: 'defaultRedirect' },
  { path: 'oauth.defaults.clientKey', section: 'defaultClientKey' },
  { path: 'supportConfig.supportEmail', section: 'support' },
  { path: 'supportConfig.supportPhone', section: 'support' },
  { path: 'supportConfig.websiteUrl', section: 'support' },
  { path: 'supportConfig.documentationUrl', section: 'support' },
  { path: 'supportConfig.termsAndConditionsUrl', section: 'support' },
  { path: 'supportConfig.privacyPolicyUrl', section: 'support' },
  { path: 'supportConfig.supportedServices', section: 'support', setLike: true },
  { path: 'billing.billingType', section: 'billing' },
  { path: 'billing.externalBilling', section: 'billing' },
  { path: 'billing.externalBillingUrl', section: 'billing' },
  { path: 'billing.hasFreeTrial', section: 'billing' },
  { path: 'billing.freeTrialDuration', section: 'billing' },
  { path: 'review.endToEndDemoUrl', section: 'review' },
  { path: 'review.scopesDemoUrl', section: 'review' },
  { path: 'review.additionalDetails', section: 'review' },
  { path: 'review.privateReason', section: 'review' },
  { path: 'webhooks.webhookUrl', section: 'authSettings' }
]

const READ_ONLY_FIELDS: Array<{ path: string; label?: string }> = [
  { path: 'schemaVersion' },
  { path: 'appId' },
  { path: 'versionId' },
  { path: 'createdAt' },
  { path: 'version' },
  { path: 'status' },
  { path: 'appType' },
  { path: 'basicInfo.contact' },
  { path: 'basicInfo.category' },
  { path: 'oauth.clientKeys', label: 'oauth.clientKeys (use `ghl app keys`)' },
  { path: 'billing.isPaidApp', label: 'billing.isPaidApp (derived from billing.billingType)' },
  { path: 'billing.isFreemium', label: 'billing.isFreemium (derived from billing.billingType)' },
  { path: 'billing.hasUsageBasedPrice', label: 'billing.hasUsageBasedPrice (managed by `ghl app billing`)' },
  { path: 'billing.paymentType', label: 'billing.paymentType (managed by subscription plans)' },
  { path: 'billing.oneTimePrice', label: 'billing.oneTimePrice (managed by subscription plans)' },
  {
    path: 'billing.additionalInfoForBilling',
    label: 'billing.additionalInfoForBilling (managed by subscription plans)'
  }
]

function canonical(value: unknown, setLike = false): unknown {
  if (setLike && Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return [...value].sort((left, right) => left.localeCompare(right))
  }
  if (Array.isArray(value)) return value.map(item => canonical(item))
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, canonical(value[key])])
  )
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function pathRoot(files: AppFiles, pathValue: string): { root: Record<string, unknown>; parts: string[] } {
  if (pathValue.startsWith('webhooks.')) {
    return { root: files.webhooks as unknown as Record<string, unknown>, parts: pathValue.split('.').slice(1) }
  }
  return { root: files.app as unknown as Record<string, unknown>, parts: pathValue.split('.') }
}

function getPath(files: AppFiles, pathValue: string): unknown {
  const { root, parts } = pathRoot(files, pathValue)
  let current: unknown = root
  for (const part of parts) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

function setPath(files: AppFiles, pathValue: string, value: unknown): void {
  const { root, parts } = pathRoot(files, pathValue)
  let current = root
  for (const part of parts.slice(0, -1)) {
    const child = current[part]
    if (!isRecord(child)) throw new Error(`Cannot apply sync field "${pathValue}" to the app model.`)
    current = child
  }
  current[parts.at(-1)!] = structuredClone(value)
}

function eventMap(files: AppFiles): Map<string, { subscribed: boolean; url: null | string }> {
  return new Map(
    files.webhooks.subscribedEvents.map(event => [event.name, { subscribed: true, url: event.url?.trim() || null }])
  )
}

function eventState(
  events: Map<string, { subscribed: boolean; url: null | string }>,
  name: string
): { subscribed: boolean; url: null | string } {
  return events.get(name) ?? { subscribed: false, url: null }
}

function applyFieldDiff(
  plan: AppSyncPlan,
  pathValue: string,
  section: PushSection,
  baseline: unknown,
  local: unknown,
  remote: unknown,
  applyLocal: () => void
): void {
  const localChanged = !equal(local, baseline)
  const remoteChanged = !equal(remote, baseline)
  if (!localChanged && !remoteChanged) return
  const change = { path: pathValue, section, baseline, local, remote }
  if (localChanged && remoteChanged && !equal(local, remote)) {
    plan.conflicts.push(change)
    return
  }
  if (localChanged && !equal(local, remote)) {
    plan.localChanges.push(change)
    applyLocal()
    return
  }
  if (remoteChanged && !localChanged) plan.remoteChanges.push(change)
}

function applySetFieldDiff(
  plan: AppSyncPlan,
  spec: FieldSpec,
  baseline: string[],
  local: string[],
  remote: string[]
): void {
  const baselineSet = new Set(baseline)
  const localSet = new Set(local)
  const desiredSet = new Set(remote)
  for (const value of new Set([...baseline, ...local, ...remote])) {
    if (localSet.has(value) === baselineSet.has(value)) continue
    if (localSet.has(value)) desiredSet.add(value)
    else desiredSet.delete(value)
  }

  const desired = [...desiredSet].sort((left, right) => left.localeCompare(right))
  const localChanged = !equal(local, baseline)
  const remoteChanged = !equal(remote, baseline)
  const change = { path: spec.path, section: spec.section, baseline, local, remote }
  if (localChanged && !equal(desired, remote)) {
    plan.localChanges.push(change)
    setPath(plan.desired, spec.path, desired)
  }
  if (remoteChanged && (!localChanged || !equal(local, remote))) plan.remoteChanges.push(change)
}

export function createAppSyncPlan(local: AppFiles, state: WorkspaceState, remote: AppFiles): AppSyncPlan {
  const plan: AppSyncPlan = {
    appId: local.app.appId,
    versionId: local.app.versionId,
    desired: structuredClone(remote),
    localChanges: [],
    remoteChanges: [],
    conflicts: [],
    sections: []
  }

  for (const spec of FIELD_SPECS) {
    const baselineValue = canonical(getPath(state.baseline, spec.path), spec.setLike)
    const localValue = canonical(getPath(local, spec.path), spec.setLike)
    const remoteValue = canonical(getPath(remote, spec.path), spec.setLike)
    if (spec.setLike && Array.isArray(baselineValue) && Array.isArray(localValue) && Array.isArray(remoteValue)) {
      applySetFieldDiff(plan, spec, baselineValue as string[], localValue as string[], remoteValue as string[])
      continue
    }
    applyFieldDiff(plan, spec.path, spec.section, baselineValue, localValue, remoteValue, () => {
      setPath(plan.desired, spec.path, localValue)
    })
  }

  for (const field of READ_ONLY_FIELDS) {
    const baselineValue = canonical(getPath(state.baseline, field.path))
    const remoteValue = canonical(getPath(remote, field.path))
    if (!equal(baselineValue, remoteValue)) {
      plan.remoteChanges.push({
        path: field.path,
        section: 'readOnly',
        baseline: baselineValue,
        local: canonical(getPath(local, field.path)),
        remote: remoteValue
      })
    }
  }

  const baselineEvents = eventMap(state.baseline)
  const localEvents = eventMap(local)
  const remoteEvents = eventMap(remote)
  const desiredEvents = eventMap(plan.desired)
  const eventNames = [...new Set([...baselineEvents.keys(), ...localEvents.keys(), ...remoteEvents.keys()])].sort()
  for (const name of eventNames) {
    const baselineValue = eventState(baselineEvents, name)
    const localValue = eventState(localEvents, name)
    const remoteValue = eventState(remoteEvents, name)
    applyFieldDiff(
      plan,
      `webhooks.subscribedEvents.${name}`,
      'authSettings',
      baselineValue,
      localValue,
      remoteValue,
      () => {
        if (!localValue.subscribed) desiredEvents.delete(name)
        else desiredEvents.set(name, localValue)
      }
    )
  }
  plan.desired.webhooks.subscribedEvents = [...desiredEvents.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, event]) => ({ name, ...(event.url ? { url: event.url } : {}) }))
  plan.sections = PUSH_SECTION_ORDER.filter(section => plan.localChanges.some(change => change.section === section))
  if (plan.sections.includes('billing')) {
    plan.desired.app.billing.isPaidApp = plan.desired.app.billing.billingType !== 'free'
    plan.desired.app.billing.isFreemium = plan.desired.app.billing.billingType === 'freemium'
  }
  return plan
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function validatedIdentity(value: {
  appId: unknown
  versionId: unknown
}): { appId: string; versionId: string } | undefined {
  if (!isAppResourceIdentifier(value.appId) || !isAppResourceIdentifier(value.versionId)) return undefined
  return { appId: value.appId, versionId: value.versionId }
}

function validateIdentity(files: AppFiles, state: WorkspaceState, errors: string[]): void {
  const app = validatedIdentity(files.app)
  const webhooks = validatedIdentity(files.webhooks)
  const workspace = validatedIdentity(state)
  const baselineApp = validatedIdentity(state.baseline.app)
  const baselineWebhooks = validatedIdentity(state.baseline.webhooks)
  if (!app || !webhooks || !workspace || !baselineApp || !baselineWebhooks) {
    errors.push('Workspace identifiers must be validated before identity checks.')
    return
  }
  if (webhooks.appId !== app.appId) {
    errors.push('Webhook manifest appId must match the app manifest appId.')
  }
  if (webhooks.versionId !== app.versionId) {
    errors.push('Webhook manifest versionId must match the app manifest versionId.')
  }
  if (workspace.appId !== app.appId || workspace.versionId !== app.versionId) {
    errors.push('Workspace state does not match the appId/versionId in ghl-app.json; run `ghl app pull` again.')
  }
  if (baselineApp.appId !== workspace.appId || baselineWebhooks.appId !== workspace.appId) {
    errors.push('Workspace state contains an inconsistent baseline appId; run `ghl app pull` again.')
  }
  if (baselineApp.versionId !== workspace.versionId || baselineWebhooks.versionId !== workspace.versionId) {
    errors.push('Workspace state contains an inconsistent baseline versionId; run `ghl app pull` again.')
  }
}

function validateCollections(files: AppFiles, errors: string[]): void {
  const collections: Array<[string, string[]]> = [
    ['OAuth scopes', files.app.oauth.allowedScopes],
    ['redirect URIs', files.app.oauth.redirectUris],
    ['categories', files.app.basicInfo.subcategory],
    ['business niches', files.app.basicInfo.businessNiche],
    ['search keywords', files.app.listing.searchKeywords],
    ['supported services', files.app.supportConfig.supportedServices],
    ['client key ids', files.app.oauth.clientKeys.map(key => key.id)],
    ['webhook events', files.webhooks.subscribedEvents.map(event => event.name)]
  ]
  for (const [label, values] of collections) {
    if (values.some(value => !value.trim())) errors.push(`${label} cannot contain blank values.`)
    const duplicates = duplicateValues(values)
    if (duplicates.length > 0) errors.push(`Duplicate ${label} are not allowed: ${duplicates.join(', ')}.`)
  }
}

function validateReadOnlyChanges(files: AppFiles, state: WorkspaceState, errors: string[]): void {
  for (const field of READ_ONLY_FIELDS) {
    if (!equal(getPath(files, field.path), getPath(state.baseline, field.path))) {
      errors.push(`${field.label ?? field.path} is read-only in app push and must match the last pull.`)
    }
  }
}

function validateListing(version: AppVersion): string[] {
  const errors: string[] = []
  const userTypes = version.userTypes ?? []
  const invalid = userTypes.filter(type => !['Company', 'Location'].includes(type))
  if (invalid.length > 0) errors.push(`Unknown listing user type(s): ${invalid.join(', ')}.`)
  if (userTypes.length === 0) errors.push('Listing must target at least one user type.')
  if (new Set(userTypes).size !== userTypes.length) errors.push('Listing user types must not contain duplicates.')
  if (userTypes.length === 1 && userTypes[0] === 'Company' && version.isAgencyBulkInstallEnabled) {
    errors.push('Agency-targeted apps cannot enable agency bulk installation.')
  }
  if (userTypes.includes('Company') && userTypes.includes('Location') && !version.isAgencyBulkInstallEnabled) {
    errors.push('Apps installed by agencies for sub-accounts must enable agency bulk installation.')
  }
  if ((version.searchKeywords ?? []).reduce((total, keyword) => total + keyword.length, 0) > 200) {
    errors.push('Search keywords can contain at most 200 characters in total.')
  }
  return errors
}

function validateBilling(files: AppFiles, version: AppVersion): string[] {
  const errors: string[] = []
  const billing = files.app.billing
  const expectedPaid = billing.billingType !== 'free'
  const expectedFreemium = billing.billingType === 'freemium'
  if (billing.isPaidApp !== expectedPaid) errors.push('billing.isPaidApp must match billing.billingType.')
  if (billing.isFreemium !== expectedFreemium) errors.push('billing.isFreemium must match billing.billingType.')
  if (!billing.externalBilling && billing.externalBillingUrl.trim()) {
    errors.push('billing.externalBillingUrl must be empty when external billing is disabled.')
  }
  if (billing.externalBilling && !billing.externalBillingUrl.trim()) {
    errors.push('billing.externalBillingUrl is required when external billing is enabled.')
  }
  if (!billing.hasFreeTrial && billing.freeTrialDuration !== null) {
    errors.push('billing.freeTrialDuration must be null when free trials are disabled.')
  }
  if (billing.hasFreeTrial && billing.freeTrialDuration === null) {
    errors.push('billing.freeTrialDuration is required when free trials are enabled.')
  }
  try {
    requirePricingEditable(version.status)
    buildBillingSettings({
      model: billing.billingType,
      externalBillingUrl: billing.externalBilling
        ? /^https:\/\//i.test(billing.externalBillingUrl)
          ? billing.externalBillingUrl
          : `https://${billing.externalBillingUrl}`
        : undefined,
      trialDays: billing.hasFreeTrial ? (billing.freeTrialDuration ?? undefined) : undefined,
      isTemplateApp: files.app.appType === 'template',
      createdAt: version.createdAt
    })
  } catch (error) {
    errors.push((error as Error).message)
  }
  return errors
}

export function appVersionFromFiles(files: AppFiles, base: AppVersion = { _id: files.app.versionId }): AppVersion {
  const { app, webhooks } = files
  return {
    ...base,
    _id: app.versionId,
    appId: app.appId,
    createdAt: app.createdAt ?? base.createdAt,
    version: app.version,
    status: app.status,
    appType: app.appType,
    name: app.basicInfo.name,
    tagline: app.basicInfo.tagline,
    companyName: app.basicInfo.companyName,
    contact: app.basicInfo.contact,
    website: app.basicInfo.website,
    category: app.basicInfo.category,
    subcategory: app.basicInfo.subcategory,
    businessNiche: app.basicInfo.businessNiche,
    logoUrl: app.basicInfo.logoUrl,
    private: app.listing.private,
    userTypes: app.listing.userTypes,
    isWhiteLabelFriendly: app.listing.isWhiteLabelFriendly,
    isAgencyBulkInstallEnabled: app.listing.isAgencyBulkInstallEnabled,
    searchKeywords: app.listing.searchKeywords,
    description: app.profiles.agency.description,
    previewImageUrls: app.profiles.agency.previewImageUrls,
    previewVideoUrl: app.profiles.agency.previewVideoUrl,
    hasSubAccountProfile: app.profiles.subAccount.enabled,
    subAccountDescription: app.profiles.subAccount.description,
    subAccountPreviewImageUrls: app.profiles.subAccount.previewImageUrls,
    subAccountPreviewVideoUrl: app.profiles.subAccount.previewVideoUrl,
    allowedScopes: app.oauth.allowedScopes,
    redirectUris: app.oauth.redirectUris,
    defaults: {
      clientKey: app.oauth.defaults.clientKey ?? undefined,
      redirectUrl: app.oauth.defaults.redirectUrl ?? undefined
    },
    clientKeys: app.oauth.clientKeys,
    supportConfig: app.supportConfig,
    webhookUrl: webhooks.webhookUrl,
    subscribedEvents: webhooks.subscribedEvents,
    billingType: app.billing.billingType,
    isPaidApp: app.billing.isPaidApp,
    isFreemium: app.billing.isFreemium,
    externalBilling: app.billing.externalBilling,
    externalBillingUrl: app.billing.externalBillingUrl,
    hasFreeTrial: app.billing.hasFreeTrial,
    freeTrialDuration: app.billing.freeTrialDuration ?? undefined,
    hasUsageBasedPrice: app.billing.hasUsageBasedPrice,
    paymentType: app.billing.paymentType,
    oneTimePrice: app.billing.oneTimePrice ?? undefined,
    additionalInfoForBilling: app.billing.additionalInfoForBilling,
    endToEndDemoUrl: app.review.endToEndDemoUrl,
    scopesDemoUrl: app.review.scopesDemoUrl,
    additionalDetails: app.review.additionalDetails,
    privateReason: app.review.privateReason
  }
}

function validateDesiredSections(files: AppFiles, sections: PushSection[], baseVersion?: AppVersion): string[] {
  const errors: string[] = []
  const version = appVersionFromFiles(files, baseVersion)
  if (sections.includes('basicInfo')) {
    const result = validateBasicInfoBody(buildBasicInfoBody(version, {}), version.isWhiteLabelFriendly)
    if (result !== true) errors.push(result)
  }
  if (sections.includes('listing')) errors.push(...validateListing(version))
  if (sections.includes('profiles')) {
    const result = validateProfilesBody(buildProfilesBody(version, {}))
    if (result !== true) errors.push(result)
  }
  if (sections.includes('support')) {
    const result = validateSupportBody(buildSupportBody(version, {}), version.appType === 'template')
    if (result !== true) errors.push(result)
  }
  if (sections.includes('authSettings')) {
    try {
      requireAuthPrereqs(version, {
        scopes: version.allowedScopes,
        redirectUris: version.redirectUris,
        webhookUrl: version.webhookUrl,
        subscribedEvents: version.subscribedEvents
      })
    } catch (error) {
      errors.push((error as Error).message)
    }
  }
  if (sections.includes('defaultRedirect')) {
    try {
      requireVersionStatus(version.status, ['live', 'deprecating', 'deprecated'], 'set a default redirect URI on')
    } catch (error) {
      errors.push((error as Error).message)
    }
    const redirect = version.defaults?.redirectUrl
    if (!redirect) errors.push('oauth.defaults.redirectUrl cannot be cleared by app push.')
    else if (!(version.redirectUris ?? []).includes(redirect)) {
      errors.push('oauth.defaults.redirectUrl must be present in oauth.redirectUris.')
    }
  }
  if (sections.includes('defaultClientKey')) {
    const clientKey = version.defaults?.clientKey
    if (!clientKey) errors.push('oauth.defaults.clientKey cannot be cleared by app push.')
    else if (!(version.clientKeys ?? []).some(key => key.id === clientKey)) {
      errors.push('oauth.defaults.clientKey must reference an existing oauth.clientKeys entry.')
    }
  }
  if (sections.includes('review')) {
    const changesResult = validateReviewDetailsChanges({
      notes: version.additionalDetails,
      privateReason: version.privateReason
    })
    if (changesResult !== true) errors.push(changesResult)
    const result = validateReviewDetailsBody(buildReviewDetailsBody(version, {}), version.private === true)
    if (result !== true) errors.push(result)
  }
  if (sections.includes('billing')) errors.push(...validateBilling(files, version))
  return errors
}

function validatePlanLifecycle(plan: AppSyncPlan): string[] {
  if (plan.desired.app.status.toLowerCase() !== 'live') return []
  const changesDraftAuth = plan.localChanges.some(change =>
    ['oauth.allowedScopes', 'oauth.redirectUris'].includes(change.path)
  )
  const createsDraftFirst = plan.sections.some(section =>
    ['listing', 'basicInfo', 'profiles', 'support'].includes(section)
  )
  const errors: string[] = []
  if (changesDraftAuth && !createsDraftFirst) {
    errors.push('OAuth scopes and redirect URIs on a live version require a draft; run `ghl app draft` first.')
  }
  if (plan.sections.includes('defaultRedirect') && (changesDraftAuth || createsDraftFirst)) {
    errors.push('A default redirect change cannot be combined with changes that create or require a draft.')
  }
  return errors
}

export function validateLocalAppWorkspace(files: AppFiles, state: WorkspaceState): AppWorkspaceValidation {
  const errors = validateAppWorkspaceSchema(files, state)
  if (errors.length > 0) return { errors, sections: [] }

  validateIdentity(files, state, errors)
  validateCollections(files, errors)
  validateReadOnlyChanges(files, state, errors)

  const plan = createAppSyncPlan(files, state, state.baseline)
  const sections = plan.sections
  errors.push(...validateDesiredSections(plan.desired, sections))
  errors.push(...validatePlanLifecycle(plan))
  return { errors: [...new Set(errors)], sections }
}

export function validateSyncPlan(plan: AppSyncPlan, remoteVersion: AppVersion): AppWorkspaceValidation {
  const errors = plan.conflicts.map(
    conflict =>
      `Conflict at ${conflict.path}: both the local workspace and developer portal changed after the last pull.`
  )
  errors.push(...validateDesiredSections(plan.desired, plan.sections, remoteVersion))
  errors.push(...validatePlanLifecycle(plan))
  return { errors: [...new Set(errors)], sections: plan.sections }
}

export function verifyAppliedChanges(plan: AppSyncPlan, remote: AppFiles): string[] {
  const remoteEvents = eventMap(remote)
  const desiredEvents = eventMap(plan.desired)
  return plan.localChanges.flatMap(change => {
    const eventName = change.path.startsWith('webhooks.subscribedEvents.')
      ? change.path.slice('webhooks.subscribedEvents.'.length)
      : undefined
    const expected = eventName ? eventState(desiredEvents, eventName) : getPath(plan.desired, change.path)
    const actual = eventName ? eventState(remoteEvents, eventName) : getPath(remote, change.path)
    const spec = FIELD_SPECS.find(field => field.path === change.path)
    return equal(canonical(expected, spec?.setLike), canonical(actual, spec?.setLike)) ? [] : [change.path]
  })
}
