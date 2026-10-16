import type { AppVersion, PreSubmitValidation, VersionListItem } from '../../api/types.js'
import type { AppOverview, Optional } from '../../app/overview.js'
import { currentInstaller, currentTarget } from '../../app/profile-sections.js'
import { isInReview, normalizeStatus } from '../../app/rules.js'
import { oneLine as clean } from '../text.js'

const APP_FILE = 'ghl-app.json'

/* Where each field the portal's pre-submit check reports is filled in with
   these tools: a ghl-app.json field (then check-workspace and push-workspace)
   or the tool that owns it. */
const READINESS_FIXES: Readonly<Record<string, string>> = {
  name: `${APP_FILE} basicInfo.name`,
  tagline: `${APP_FILE} basicInfo.tagline`,
  category: `${APP_FILE} basicInfo.subcategory`,
  userTypes: `${APP_FILE} listing.userTypes`,
  description: `${APP_FILE} profiles.agency.description`,
  subAccountDescription: `${APP_FILE} profiles.subAccount.description`,
  supportDetails: `${APP_FILE} supportConfig.supportEmail or supportPhone`,
  scopes: `${APP_FILE} oauth.allowedScopes; list-scopes has the names`,
  redirectUri: `${APP_FILE} oauth.redirectUris`,
  logo: 'update-media logo',
  previewImages: 'update-media screenshots, 3+ for the agency profile',
  subAccountPreviewImages: 'update-media screenshots, 3+ with profile sub-account',
  clientKeys: 'manage-client-keys create',
  mcpUrl: 'developer portal only',
  externalAuth: 'developer portal only',
  externalAuthConfig: 'developer portal only'
}

function readinessFix(field: string): string | undefined {
  return Object.hasOwn(READINESS_FIXES, field) ? READINESS_FIXES[field] : undefined
}

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none'
}

function fields(entries: ReadonlyArray<[string, string | undefined]>): string {
  return entries
    .filter(([, value]) => value)
    .map(([label, value]) => `${label} ${clean(value)}`)
    .join('; ')
}

export function versionLabel(version: { version?: string; status?: string }): string {
  return [...new Set([version.version ?? 'unversioned', version.status])]
    .filter(Boolean)
    .map(part => clean(part, 40))
    .join(' ')
}

function headline(overview: AppOverview): string[] {
  const version = overview.version
  const audience =
    currentTarget(version) === 'agency'
      ? 'agency app'
      : `sub-account app installed by ${currentInstaller(version) === 'agency-only' ? 'agencies only' : 'agencies and sub-accounts'}`
  const traits = [
    clean(version.status, 40) || 'unknown status',
    version.private ? 'private' : 'public',
    audience,
    (version.isWhiteLabelFriendly ?? true) ? 'white-label' : 'standard listing'
  ]
  return [
    `${clean(version.name ?? overview.selected.name ?? 'Unnamed app', 100)} (appId ${clean(overview.selected.appId, 128)})`,
    `Version ${clean(version.version, 40) || 'unversioned'} (versionId ${clean(version._id, 128)}): ${traits.join(', ')}.`
  ]
}

/* Storage URLs share a long prefix; the file name identifies the media. */
export function mediaFile(url: string | undefined): string {
  return clean(url?.split('/').pop(), 120)
}

function versionsLine(versions: readonly VersionListItem[]): string {
  return `All versions: ${versions.map(item => `${versionLabel(item)} (${clean(item._id, 128)})`).join('; ') || 'none'}.`
}

function configurationLines(version: AppVersion): string[] {
  const defaultKey = version.defaults?.clientKey
  const keys = (version.clientKeys ?? [])
    .filter(key => !key.deleted)
    .map(
      key =>
        `${clean(key.name ?? 'unnamed', 60)} (${clean(key.id, 128)}${key.id === defaultKey || key.isDefault ? ', default' : ''})`
    )
  const events = (version.subscribedEvents ?? []).map(event =>
    event.url ? `${clean(event.name, 80)} -> ${clean(event.url)}` : clean(event.name, 80)
  )
  const billing = [
    clean(version.billingType, 40) || 'free',
    version.externalBilling ? `external billing ${clean(version.externalBillingUrl)}` : '',
    version.hasFreeTrial ? `${clean(version.freeTrialDuration, 10) || '?'}-day free trial` : ''
  ]
  const support = version.supportConfig ?? {}
  return [
    `Basic info: ${
      fields([
        ['tagline', version.tagline && `"${version.tagline}"`],
        ['company', version.companyName],
        ['website', version.website],
        ['categories', (version.subcategory ?? []).join(', ')]
      ]) || 'not set'
    }.`,
    `OAuth: scopes ${list((version.allowedScopes ?? []).map(scope => clean(scope, 100)))}; redirect URIs ${list(
      (version.redirectUris ?? []).map(uri => clean(uri))
    )}; client keys ${list(keys)}.`,
    `Media files: logo ${mediaFile(version.logoUrl) || 'not set'}; agency screenshots ${list(
      (version.previewImageUrls ?? []).map(mediaFile)
    )}; sub-account screenshots ${list((version.subAccountPreviewImageUrls ?? []).map(mediaFile))}.`,
    `Webhooks: URL ${clean(version.webhookUrl) || 'not set'}; events ${list(events)}.`,
    `Billing: ${billing.filter(Boolean).join(', ')}.`,
    `Support: ${
      fields([
        ['email', support.supportEmail],
        ['website', support.websiteUrl],
        ['docs', support.documentationUrl],
        ['terms', support.termsAndConditionsUrl],
        ['privacy', support.privacyPolicyUrl]
      ]) || 'not set'
    }.`
  ]
}

function moduleLine(
  label: string,
  modules: Optional<ReadonlyArray<{ name: string; version: string; status?: string }>>
): string {
  if ('error' in modules) return `${label}: unavailable (${clean(modules.error)}).`
  const names = modules.value.map(item => `${clean(item.name, 80)} ${versionLabel(item)}`)
  return `${label}: ${list(names)}.`
}

function missingFields(readiness: PreSubmitValidation): string[] {
  return Object.entries(readiness.mandatoryFields ?? {})
    .filter(([, satisfied]) => !satisfied)
    .map(([field]) => field)
}

/* Private apps skip marketplace review, which decides what "ready" means. */
function publishOutcome(version: AppVersion): string {
  return version.private === true
    ? 'this private app goes live on publish, without marketplace review'
    : 'publishing submits it for marketplace review'
}

function readinessLine(readiness: PreSubmitValidation, missing: string[], version: AppVersion): string {
  if (missing.length > 0) {
    const fixes = missing.map(field => {
      const fix = readinessFix(field)
      return fix ? `${field} (${fix})` : clean(field, 80)
    })
    return `Publish readiness: missing ${fixes.join('; ')}.`
  }
  return readiness.success
    ? `Publish readiness: every required field is set; ${publishOutcome(version)}.`
    : `Publish readiness: ${clean(readiness.message) || 'the check did not pass'}.`
}

/* Only drafts are edited in place: live edits start a new draft, and other versions stay as they are. */
function lockedVersionLine(status: string | undefined): string {
  if (isInReview(status)) {
    return 'This version is in review and cannot be edited; release-app withdraw makes it a draft again.'
  }
  if (normalizeStatus(status) === 'live') return 'This version is live; edits create a new draft version.'
  return `This version is ${clean(status, 40) || 'unavailable'} and cannot be edited.`
}

function readinessLines(overview: AppOverview): string[] {
  const { readiness, analysis } = overview
  if (!readiness) return [lockedVersionLine(overview.version.status)]
  const missing = 'value' in readiness ? missingFields(readiness.value) : []
  const lines = [
    'value' in readiness
      ? readinessLine(readiness.value, missing, overview.version)
      : `Publish readiness: unavailable (${clean(readiness.error)}).`
  ]
  if (analysis && 'value' in analysis && analysis.value.suggestedVersion) {
    lines.push(
      `Next version: ${clean(analysis.value.suggestedVersion, 40)} (latest live ${clean(analysis.value.latestLiveVersion, 40) || 'none'}).`
    )
  }
  if (missing.some(field => readinessFix(field)?.startsWith(APP_FILE))) {
    lines.push(
      `Next: set the ${APP_FILE} fields in the app workspace (pull-app creates one), then check-workspace and push-workspace.`
    )
  }
  return lines
}

export function appOverviewText(overview: AppOverview): string {
  return [
    ...headline(overview),
    versionsLine(overview.versions),
    ...configurationLines(overview.version),
    moduleLine('Workflow actions', overview.actions),
    moduleLine('Workflow triggers', overview.triggers),
    ...readinessLines(overview)
  ].join('\n')
}
