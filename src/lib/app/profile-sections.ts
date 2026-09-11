import { type AppVersion, type ProfileUpdateResult } from '../api/client.js'
import { BUSINESS_NICHE_VALUES, SUBCATEGORY_VALUES } from './categories.js'
import {
  validateEmail,
  validateHttpsUrl,
  validatePhone,
  validateTextForWhiteLabel,
  validateXssSafe,
  validateYouTubeUrl
} from '../shared/validation.js'

export const DESCRIPTION_MIN_LENGTH = 300
export const DESCRIPTION_MAX_LENGTH = 5000
export const SUPPORTED_SERVICES = [
  'author_availability',
  'technical_questions',
  'bug_assistance',
  'third_party_assets',
  'customization_services',
  'installation_services'
] as const
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg'])

function normalizedSupportUrl(value: string): string {
  const trimmed = value.trim()
  return !trimmed || trimmed.includes('://') ? trimmed : `https://${trimmed}`
}

function validateImageUrl(value: string, label: string): string | true {
  const urlResult = validateHttpsUrl(value, label)
  if (urlResult !== true) return urlResult
  const pathname = new URL(value).pathname.toLowerCase()
  const dotIndex = pathname.lastIndexOf('.')
  return dotIndex >= 0 && IMAGE_EXTENSIONS.has(pathname.slice(dotIndex))
    ? true
    : `${label} must end with .png, .jpg, .jpeg, .svg, or .gif.`
}

/* Mirrors the portal's rule: 300-5000 chars of plain text, HTML stripped. */
export function validateDescription(value: string): string | true {
  const textLength = value.replace(/<[^>]*>/g, '').trim().length
  if (textLength < DESCRIPTION_MIN_LENGTH) {
    return `App description must be at least ${DESCRIPTION_MIN_LENGTH} characters (currently ${textLength}).`
  }
  if (textLength > DESCRIPTION_MAX_LENGTH) {
    return `App description must be at most ${DESCRIPTION_MAX_LENGTH} characters (currently ${textLength}).`
  }
  return true
}

export interface BasicInfoChanges {
  name?: string
  tagline?: string
  companyName?: string
  website?: string
  subcategory?: string[]
  businessNiche?: string[]
  logoUrl?: string
}

export interface ListingChanges {
  type?: 'public' | 'private'
  target?: 'sub-account' | 'agency'
  installer?: 'everyone' | 'agency-only'
  listing?: 'white-label' | 'standard'
  keywords?: string[]
}

export interface ProfilesChanges {
  description?: string
  previewVideoUrl?: string
  previewImageUrls?: string[]
  hasSubAccountProfile?: boolean
  subAccountDescription?: string
  subAccountPreviewVideoUrl?: string
  subAccountPreviewImageUrls?: string[]
}

export interface SupportChanges {
  supportEmail?: string
  supportPhone?: string
  websiteUrl?: string
  documentationUrl?: string
  termsAndConditionsUrl?: string
  privacyPolicyUrl?: string
  supportedServices?: string[]
}

/* Section bodies mirror what the portal pages send: the full section merged
   from current values plus the requested changes, always carrying `private`. */
export function buildBasicInfoBody(version: AppVersion, changes: BasicInfoChanges) {
  const common = {
    private: version.private ?? false,
    companyName: changes.companyName ?? version.companyName ?? '',
    website: changes.website ?? version.website ?? ''
  }
  if (version.appType === 'template') return { ...common, appType: 'template' as const }
  return {
    ...common,
    name: changes.name ?? version.name ?? '',
    tagline: changes.tagline ?? version.tagline ?? '',
    category: '',
    subcategory: changes.subcategory ?? version.subcategory ?? [],
    businessNiche: changes.businessNiche ?? version.businessNiche ?? [],
    logoUrl: changes.logoUrl ?? version.logoUrl ?? ''
  }
}

export function validateBasicInfoBody(
  body: ReturnType<typeof buildBasicInfoBody>,
  isWhiteLabelFriendly = false
): string | true {
  const companyName = body.companyName.trim()
  if (!companyName) return 'Company name is required.'
  if (companyName.length > 50) return 'Company name must be at most 50 characters.'
  if (isWhiteLabelFriendly) {
    const result = validateTextForWhiteLabel(companyName, 'Company name')
    if (result !== true) return result
  }
  const companySafety = validateXssSafe(companyName, 'Company name')
  if (companySafety !== true) return companySafety
  if (body.website.trim()) {
    const result = validateHttpsUrl(body.website, 'Website URL')
    if (result !== true) return result
    if (isWhiteLabelFriendly) {
      const whiteLabelResult = validateTextForWhiteLabel(body.website, 'Website URL')
      if (whiteLabelResult !== true) return whiteLabelResult
    }
  }
  if ('appType' in body) return true

  const name = body.name.trim()
  if (!name) return 'App name is required.'
  if (name.length > 50) return 'App name must be at most 50 characters.'
  const nameSafety = validateXssSafe(name, 'App name')
  if (nameSafety !== true) return nameSafety

  const taglineLength = body.tagline.trim().length
  if (taglineLength < 20) return 'Tagline must be at least 20 characters.'
  if (taglineLength > 170) return 'Tagline must be at most 170 characters.'
  const taglineSafety = validateXssSafe(body.tagline, 'Tagline')
  if (taglineSafety !== true) return taglineSafety
  if (body.subcategory.length < 1 || body.subcategory.length > 3) return 'Select between 1 and 3 categories.'
  const invalidCategories = body.subcategory.filter(value => !SUBCATEGORY_VALUES.includes(value.toLowerCase()))
  if (invalidCategories.length > 0) return `Unknown category: ${invalidCategories.join(', ')}.`
  if (body.businessNiche.length > 3) return 'Select at most 3 business niches.'
  const invalidNiches = body.businessNiche.filter(value => !BUSINESS_NICHE_VALUES.includes(value.toLowerCase()))
  if (invalidNiches.length > 0) return `Unknown business niche: ${invalidNiches.join(', ')}.`
  if (body.logoUrl.trim()) return validateImageUrl(body.logoUrl, 'Logo URL')
  return true
}

export function currentTarget(version: AppVersion): 'sub-account' | 'agency' {
  const types = version.userTypes ?? []
  return types.includes('Company') && !types.includes('Location') ? 'agency' : 'sub-account'
}

export function currentInstaller(version: AppVersion): 'everyone' | 'agency-only' {
  const types = version.userTypes ?? []
  return types.includes('Location') && types.includes('Company') ? 'agency-only' : 'everyone'
}

export function buildListingBody(version: AppVersion, changes: ListingChanges) {
  const target = changes.target ?? currentTarget(version)
  if (target === 'agency' && changes.installer) {
    throw new Error('--installer only applies when the target user is sub-account.')
  }
  const installer = changes.installer ?? currentInstaller(version)
  const userTypes =
    target === 'agency' ? ['Company'] : installer === 'agency-only' ? ['Location', 'Company'] : ['Location']
  const whiteLabel =
    changes.listing !== undefined ? changes.listing === 'white-label' : (version.isWhiteLabelFriendly ?? true)
  const bulkInstallEnabled =
    target === 'agency' ? false : installer === 'agency-only' ? true : (version.isAgencyBulkInstallEnabled ?? false)

  return {
    private: changes.type !== undefined ? changes.type === 'private' : (version.private ?? false),
    userTypes,
    isWhiteLabelFriendly: whiteLabel,
    isAgencyBulkInstallEnabled: bulkInstallEnabled,
    searchKeywords: changes.keywords ?? version.searchKeywords ?? []
  }
}

export interface ReviewDetailsChanges {
  demoUrl?: string
  scopesDemoUrl?: string
  testCredentials?: string
  notes?: string
  privateReason?: string
}

/* Mirrors the portal's App Review Details modal: both demo URLs must be https. */
export function validateDemoUrl(value: string): string | true {
  return validateHttpsUrl(value, 'Demo URL') === true ? true : 'Demo URLs must be valid https:// URLs.'
}

/* Private submissions additionally carry bypassDraft + private and need a reason,
   exactly like the portal's modal. */
export function buildReviewDetailsBody(version: AppVersion, changes: ReviewDetailsChanges) {
  const isPrivate = version.private === true
  return {
    endToEndDemoUrl: changes.demoUrl ?? version.endToEndDemoUrl ?? '',
    scopesDemoUrl: changes.scopesDemoUrl ?? version.scopesDemoUrl ?? '',
    testCredentials: changes.testCredentials ?? version.testCredentials ?? '',
    additionalDetails: changes.notes ?? version.additionalDetails ?? '',
    privateReason: changes.privateReason ?? version.privateReason ?? '',
    ...(isPrivate ? { bypassDraft: true, private: true } : {})
  }
}

export function buildProfilesBody(version: AppVersion, changes: ProfilesChanges) {
  const disablingSubAccountProfile = changes.hasSubAccountProfile === false
  return {
    private: version.private ?? false,
    description: changes.description ?? version.description ?? '',
    previewImageUrls: changes.previewImageUrls ?? version.previewImageUrls ?? [],
    previewVideoUrl: changes.previewVideoUrl ?? version.previewVideoUrl ?? '',
    hasSubAccountProfile: changes.hasSubAccountProfile ?? version.hasSubAccountProfile ?? false,
    subAccountDescription: disablingSubAccountProfile
      ? ''
      : (changes.subAccountDescription ?? version.subAccountDescription ?? ''),
    subAccountPreviewImageUrls: disablingSubAccountProfile
      ? []
      : (changes.subAccountPreviewImageUrls ?? version.subAccountPreviewImageUrls ?? []),
    subAccountPreviewVideoUrl: disablingSubAccountProfile
      ? ''
      : (changes.subAccountPreviewVideoUrl ?? version.subAccountPreviewVideoUrl ?? '')
  }
}

export function validateProfilesBody(body: ReturnType<typeof buildProfilesBody>): string | true {
  if (body.previewImageUrls.length > 9) return 'Agency profile can contain at most 9 screenshots.'
  for (const url of body.previewImageUrls) {
    const result = validateImageUrl(url, 'Agency preview image URL')
    if (result !== true) return result
  }
  if (body.previewVideoUrl) {
    const result = validateYouTubeUrl(body.previewVideoUrl, 'Preview video URL')
    if (result !== true) return result
  }
  const descriptionResult = validateDescription(body.description)
  if (descriptionResult !== true) return descriptionResult
  const descriptionSafety = validateXssSafe(body.description, 'App description')
  if (descriptionSafety !== true) return descriptionSafety

  if (body.subAccountPreviewVideoUrl) {
    const result = validateYouTubeUrl(body.subAccountPreviewVideoUrl, 'Sub-account preview video URL')
    if (result !== true) return result
  }
  if (!body.hasSubAccountProfile) {
    if (
      body.subAccountDescription.trim() ||
      body.subAccountPreviewImageUrls.length > 0 ||
      body.subAccountPreviewVideoUrl.trim()
    ) {
      return 'Enable the sub-account profile before adding sub-account profile details.'
    }
    return true
  }

  if (body.subAccountPreviewImageUrls.length > 9) return 'Sub-account profile can contain at most 9 screenshots.'
  for (const url of body.subAccountPreviewImageUrls) {
    const result = validateImageUrl(url, 'Sub-account preview image URL')
    if (result !== true) return result
  }

  const subAccountDescriptionResult = validateDescription(body.subAccountDescription)
  if (subAccountDescriptionResult !== true) {
    return subAccountDescriptionResult.replace('App description', 'Sub-account description')
  }
  const subAccountDescriptionSafety = validateXssSafe(body.subAccountDescription, 'Sub-account description')
  if (subAccountDescriptionSafety !== true) return subAccountDescriptionSafety
  if (body.subAccountPreviewImageUrls.length < 3) return 'Sub-account profile requires at least 3 screenshots.'
  return true
}

export function buildSupportBody(version: AppVersion, changes: SupportChanges) {
  const current = version.supportConfig ?? {}
  return {
    private: version.private ?? false,
    supportConfig: {
      supportEmail: (changes.supportEmail ?? current.supportEmail ?? '').trim(),
      supportPhone: (changes.supportPhone ?? current.supportPhone ?? '').trim(),
      websiteUrl: normalizedSupportUrl(changes.websiteUrl ?? current.websiteUrl ?? ''),
      documentationUrl: normalizedSupportUrl(changes.documentationUrl ?? current.documentationUrl ?? ''),
      termsAndConditionsUrl: normalizedSupportUrl(changes.termsAndConditionsUrl ?? current.termsAndConditionsUrl ?? ''),
      privacyPolicyUrl: normalizedSupportUrl(changes.privacyPolicyUrl ?? current.privacyPolicyUrl ?? ''),
      supportedServices: changes.supportedServices ?? current.supportedServices ?? []
    }
  }
}

export function validateSupportBody(body: ReturnType<typeof buildSupportBody>, isTemplate = false): string | true {
  const { supportConfig } = body
  if (!supportConfig.supportEmail.trim() && !supportConfig.supportPhone.trim()) {
    return 'A support email or support phone is required.'
  }
  if (supportConfig.supportEmail.trim()) {
    const result = validateEmail(supportConfig.supportEmail)
    if (result !== true) return result
  }
  if (supportConfig.supportPhone.trim()) {
    const result = validatePhone(supportConfig.supportPhone)
    if (result !== true) return result
  }
  const urls: Array<[string, string]> = [
    ['Website URL', supportConfig.websiteUrl],
    ['Documentation URL', supportConfig.documentationUrl],
    ['Terms and conditions URL', supportConfig.termsAndConditionsUrl],
    ['Privacy policy URL', supportConfig.privacyPolicyUrl]
  ]
  for (const [label, value] of urls) {
    if (!value.trim()) continue
    const result = validateSupportUrl(value, label)
    if (result !== true) return result
  }
  const unknownServices = supportConfig.supportedServices.filter(
    service => !SUPPORTED_SERVICES.includes(service as (typeof SUPPORTED_SERVICES)[number])
  )
  if (unknownServices.length > 0) {
    return `Unknown supported service(s): ${unknownServices.join(', ')}.`
  }
  if (new Set(supportConfig.supportedServices).size !== supportConfig.supportedServices.length) {
    return 'Supported services must not contain duplicates.'
  }
  if (isTemplate && supportConfig.supportedServices.length === 0) {
    return 'Template apps require at least one supported service.'
  }
  return true
}

export function validateSupportUrl(value: string, label: string): string | true {
  return validateHttpsUrl(normalizedSupportUrl(value), label)
}

export function validateReviewDetailsBody(
  body: ReturnType<typeof buildReviewDetailsBody>,
  isPrivate: boolean
): string | true {
  if (!body.endToEndDemoUrl.trim()) return 'End-to-end demo URL is required.'
  const demoResult = validateHttpsUrl(body.endToEndDemoUrl, 'End-to-end demo URL')
  if (demoResult !== true) return demoResult
  if (!body.scopesDemoUrl.trim()) return 'Scopes demo URL is required.'
  const scopesResult = validateHttpsUrl(body.scopesDemoUrl, 'Scopes demo URL')
  if (scopesResult !== true) return scopesResult
  if (isPrivate && !body.privateReason.trim()) return 'A reason is required for private app review.'
  return true
}

export function validateReviewDetailsChanges(changes: ReviewDetailsChanges): string | true {
  const limitedFields: Array<[string, string, number]> = [
    ['Test credentials', changes.testCredentials ?? '', 200],
    ['Additional details', changes.notes ?? '', 500],
    ['Private reason', changes.privateReason ?? '', 500]
  ]
  for (const [label, value, maximum] of limitedFields) {
    if (value.length > maximum) return `${label} must be at most ${maximum} characters.`
    const safety = validateXssSafe(value, label)
    if (safety !== true) return safety
  }
  return true
}

export function validateStoredReviewDetails(version: AppVersion, isPrivate: boolean): string | true {
  if (version.appType === 'template') return true
  return validateReviewDetailsBody(buildReviewDetailsBody(version, {}), isPrivate)
}

/* Saving a section of a live version silently creates a new pending draft —
   the response carries the new ids the local selection must follow. */
export function extractNewVersion(result: ProfileUpdateResult): { appId?: string; versionId?: string } {
  const doc = result?.oAuthClient ?? result?.pendingOAuthClient
  if (!doc) return {}
  return { appId: doc.appId, versionId: doc._id ?? doc.id }
}
