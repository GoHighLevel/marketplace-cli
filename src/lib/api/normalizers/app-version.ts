import {
  hasOptionalBooleanFields,
  hasOptionalFiniteNumberFields,
  hasOptionalStringArrayFields,
  hasOptionalStringFields,
  isStringArray
} from './fields.js'
import { isRecord } from '../response.js'
import type { AppVersion, ProfileUpdateResult } from '../types.js'

type ClientKey = NonNullable<AppVersion['clientKeys']>[number]

function normalizeClientKeys(value: unknown): ClientKey[] | undefined {
  if (!Array.isArray(value)) return undefined
  const keys: ClientKey[] = []
  for (const key of value) {
    if (
      !isRecord(key) ||
      typeof key.id !== 'string' ||
      !key.id ||
      !hasOptionalStringFields(key, ['name']) ||
      !hasOptionalBooleanFields(key, ['deleted', 'isDefault', 'default'])
    ) {
      return undefined
    }
    keys.push({
      id: key.id,
      ...(typeof key.name === 'string' ? { name: key.name } : {}),
      ...(typeof key.deleted === 'boolean' ? { deleted: key.deleted } : {}),
      ...(typeof key.isDefault === 'boolean' ? { isDefault: key.isDefault } : {}),
      ...(typeof key.default === 'boolean' ? { default: key.default } : {})
    })
  }
  return keys
}

function normalizeDefaults(value: unknown): AppVersion['defaults'] | undefined {
  if (!isRecord(value) || !hasOptionalStringFields(value, ['clientKey', 'redirectUrl'])) return undefined
  return {
    ...(typeof value.clientKey === 'string' ? { clientKey: value.clientKey } : {}),
    ...(typeof value.redirectUrl === 'string' ? { redirectUrl: value.redirectUrl } : {})
  }
}

function isAppVersion(value: unknown): value is AppVersion {
  if (!isRecord(value) || typeof value._id !== 'string' || value._id.length === 0) return false
  if (
    !hasOptionalStringFields(
      value,
      [
        'appId',
        'createdAt',
        'name',
        'version',
        'status',
        'appType',
        'externalBillingUrl',
        'paymentType',
        'additionalInfoForBilling',
        'tagline',
        'companyName',
        'website',
        'category',
        'logoUrl',
        'description',
        'previewVideoUrl',
        'subAccountDescription',
        'subAccountPreviewVideoUrl',
        'webhookUrl',
        'endToEndDemoUrl',
        'scopesDemoUrl',
        'testCredentials',
        'additionalDetails',
        'privateReason'
      ],
      true
    ) ||
    !hasOptionalBooleanFields(
      value,
      [
        'private',
        'externalBilling',
        'isPaidApp',
        'isFreemium',
        'hasFreeTrial',
        'hasUsageBasedPrice',
        'hasExternalAuth',
        'isWhiteLabelFriendly',
        'isAgencyBulkInstallEnabled',
        'hasSubAccountProfile'
      ],
      true
    ) ||
    !hasOptionalFiniteNumberFields(value, ['freeTrialDuration', 'oneTimePrice'], true) ||
    !hasOptionalStringArrayFields(
      value,
      [
        'subcategory',
        'businessNiche',
        'userTypes',
        'searchKeywords',
        'previewImageUrls',
        'subAccountPreviewImageUrls',
        'allowedScopes',
        'redirectUris'
      ],
      true
    ) ||
    (value.billingType !== undefined &&
      value.billingType !== null &&
      !['free', 'paid', 'freemium'].includes(String(value.billingType)))
  ) {
    return false
  }

  if (
    value.contact !== undefined &&
    value.contact !== null &&
    (!isRecord(value.contact) || !hasOptionalStringFields(value.contact, ['email', 'name']))
  ) {
    return false
  }

  for (const field of ['externalConfig', 'externalAuthConfig', 'mcpConfig'] as const) {
    if (value[field] !== undefined && value[field] !== null && !isRecord(value[field])) return false
  }
  if (
    value.customPages !== undefined &&
    value.customPages !== null &&
    (!Array.isArray(value.customPages) || !value.customPages.every(page => isRecord(page)))
  ) {
    return false
  }

  if (value.supportConfig !== undefined && value.supportConfig !== null) {
    if (
      !isRecord(value.supportConfig) ||
      !hasOptionalStringFields(value.supportConfig, [
        'supportEmail',
        'supportPhone',
        'websiteUrl',
        'documentationUrl',
        'termsAndConditionsUrl',
        'privacyPolicyUrl'
      ]) ||
      (value.supportConfig.supportedServices !== undefined && !isStringArray(value.supportConfig.supportedServices))
    ) {
      return false
    }
  }

  if (
    value.clientKeys !== undefined &&
    value.clientKeys !== null &&
    normalizeClientKeys(value.clientKeys) === undefined
  ) {
    return false
  }

  if (value.defaults !== undefined && value.defaults !== null && normalizeDefaults(value.defaults) === undefined) {
    return false
  }

  if (
    value.securityReview !== undefined &&
    value.securityReview !== null &&
    (!isRecord(value.securityReview) ||
      !hasOptionalStringFields(value.securityReview, ['status']) ||
      !hasOptionalBooleanFields(value.securityReview, ['reviewed']))
  ) {
    return false
  }

  return (
    value.subscribedEvents === undefined ||
    value.subscribedEvents === null ||
    (Array.isArray(value.subscribedEvents) &&
      value.subscribedEvents.every(
        event =>
          isRecord(event) &&
          typeof event.name === 'string' &&
          event.name.length > 0 &&
          hasOptionalStringFields(event, ['url']) &&
          hasOptionalBooleanFields(event, ['warningFlag'])
      ))
  )
}

export function normalizeAppVersion(value: unknown): AppVersion | undefined {
  const normalizedValue =
    isRecord(value) && typeof value.subcategory === 'string' ? { ...value, subcategory: [value.subcategory] } : value
  if (!isAppVersion(normalizedValue)) return undefined
  const record = normalizedValue as AppVersion & Record<string, unknown>
  const nestedValue = record.oAuthClient
  const nested = nestedValue == null ? [] : Array.isArray(nestedValue) ? nestedValue : [nestedValue]
  if (
    nested.some(
      source =>
        !isRecord(source) ||
        (source.clientKeys != null && normalizeClientKeys(source.clientKeys) === undefined) ||
        (source.defaults != null && normalizeDefaults(source.defaults) === undefined) ||
        (source.redirectUris != null && !isStringArray(source.redirectUris))
    )
  ) {
    return undefined
  }

  const sources = nested as Record<string, unknown>[]
  const keys = [...(normalizeClientKeys(normalizedValue.clientKeys) ?? [])]
  const seen = new Set(keys.map(key => key.id))
  for (const source of sources) {
    for (const key of normalizeClientKeys(source.clientKeys) ?? []) {
      if (!seen.has(key.id)) {
        keys.push(key)
        seen.add(key.id)
      }
    }
  }

  const nestedDefaults = sources.map(source => normalizeDefaults(source.defaults)).find(Boolean)
  const defaults = nestedDefaults ?? normalizeDefaults(normalizedValue.defaults)
  const redirectsSource = sources.find(source => source.redirectUris != null)
  const { oAuthClient: _oAuthClient, ...rawBase } = record
  const base = Object.fromEntries(Object.entries(rawBase).filter(([, field]) => field !== null))
  const legacyBillingType =
    normalizedValue.isPaidApp == null
      ? undefined
      : normalizedValue.isPaidApp
        ? normalizedValue.isFreemium
          ? 'freemium'
          : 'paid'
        : 'free'
  const billingType = normalizedValue.billingType ?? legacyBillingType
  return {
    ...base,
    ...(billingType ? { billingType } : {}),
    ...(keys.length > 0 || normalizedValue.clientKeys !== undefined ? { clientKeys: keys } : {}),
    ...(defaults ? { defaults } : {}),
    ...(redirectsSource ? { redirectUris: redirectsSource.redirectUris as string[] } : {})
  } as AppVersion
}

export function validateProfileUpdateResponse(response: unknown, label: string): ProfileUpdateResult {
  if (!isRecord(response)) throw new Error(`${label} API returned an unexpected response.`)
  const result: ProfileUpdateResult = {}
  for (const field of ['oAuthClient', 'pendingOAuthClient'] as const) {
    const document = response[field]
    if (document === undefined) continue
    if (
      !isRecord(document) ||
      !hasOptionalStringFields(document, ['_id', 'id', 'appId']) ||
      ![document._id, document.id].some(id => typeof id === 'string' && id.length > 0)
    ) {
      throw new Error(`${label} API returned an unexpected response.`)
    }
    result[field] = document
  }
  if (!result.oAuthClient && !result.pendingOAuthClient) {
    throw new Error(`${label} API returned an unexpected response.`)
  }
  return result
}
