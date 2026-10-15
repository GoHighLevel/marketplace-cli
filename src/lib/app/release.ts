import type { ApiClient } from '../api/client.js'
import type { AppVersion, VersionListItem } from '../api/types.js'
import type { CliConfig } from '../config/environment.js'
import type { SelectedApp } from '../config/selection-store.js'
import { CodedError, errorMessage } from '../shared/errors.js'
import { validateDeprecationDate } from '../shared/validation.js'
import { persistSelection } from './context.js'
import { refreshAppWorkspaceLifecycle } from './lifecycle.js'
import { validateStoredReviewDetails } from './profile-sections.js'
import {
  formatReadinessError,
  normalizeStatus,
  requireSecurityReviewEligible,
  requireVersionStatus,
  requiresPublicReviewDetails
} from './rules.js'
import {
  activeVersionCount,
  baseVersionFromList,
  type BumpOption,
  bumpOptions,
  MAX_PENDING_VERSIONS,
  minimumBumpFromAnalysis,
  pendingVersions,
  requireDeprecatable,
  requireDraftable,
  validateNewVersion
} from './versioning.js'

/* One app version and the session that acts on it. */
export interface ReleaseTarget {
  client: ApiClient
  config: CliConfig
  selected: SelectedApp
  version: AppVersion
}

export interface PublishPreparation {
  isPrivate: boolean
  /* The live version a release bumps; undefined before the first publish,
     which is always 1.0.0. */
  baseVersion?: string
  options: BumpOption[]
  suggestedVersion?: string
}

export interface PublishRequest {
  newVersion: string
  agencyNotes: string
  subAccountNotes: string
}

export interface DeprecationRequest {
  date: string
  timezone: string
  notes: string
}

export const FIRST_VERSION = '1.0.0'
/* The portal reports a submitted version as `review` or `in review`. */
export const REVIEW_STATUSES = ['review', 'inreview']

/* The portal's mandatory-field check plus, when required, the review
   details reviewers need; fails with the fix instead of a raw API 400. */
async function assertReadiness(
  client: ApiClient,
  appId: string,
  version: AppVersion,
  reviewDetails?: 'public' | 'private'
): Promise<void> {
  const validation = await client.preSubmitValidation(appId, version._id)
  const missing = Object.values(validation.mandatoryFields ?? {}).some(valid => !valid)
  if (!validation.success || missing) throw new CodedError('INVALID_STATE', formatReadinessError(validation))
  if (!reviewDetails) return
  const details = validateStoredReviewDetails(version, reviewDetails === 'private')
  if (details !== true)
    throw new CodedError('INVALID_STATE', `${details} Complete the fields with \`ghl app review-details\` first.`)
}

/* Everything the portal checks before a publish, plus the version numbers
   the release may use. Fails early with the fix instead of a raw API 400. */
export async function preparePublish(target: ReleaseTarget): Promise<PublishPreparation> {
  const { client, selected, version } = target
  requireVersionStatus(version.status, ['draft', 'disapproved'], 'publish')
  const isPrivate = version.private === true
  /* Public review submissions are rejected without the App Review Details. */
  await assertReadiness(client, selected.appId, version, requiresPublicReviewDetails(version) ? 'public' : undefined)
  const versions = await client.listVersions(selected.appId)
  /* The portal allows one pending (in-review) version at a time. */
  const pending = pendingVersions(versions, selected.versionId)
  if (pending.length >= MAX_PENDING_VERSIONS) {
    throw new CodedError(
      'INVALID_STATE',
      `Version ${pending[0].version ?? pending[0]._id} is already pending — finish or withdraw it before publishing another version.`
    )
  }
  const baseVersion = baseVersionFromList(versions)
  if (baseVersion === undefined) return { isPrivate, options: [] }
  const analysis = await client.analyzeVersion(selected.appId, selected.versionId)
  const options = bumpOptions({
    baseVersion,
    minimumBump: minimumBumpFromAnalysis(analysis),
    activeVersionCount: activeVersionCount(versions)
  })
  if (options.every(option => option.disabledReason)) {
    throw new CodedError(
      'INVALID_STATE',
      `No version bump is currently allowed: ${options.map(option => option.disabledReason)[0]}.`
    )
  }
  return {
    isPrivate,
    baseVersion,
    options,
    ...(analysis.suggestedVersion ? { suggestedVersion: analysis.suggestedVersion } : {})
  }
}

export function allowedVersions(preparation: PublishPreparation): string {
  return preparation.options
    .filter(option => !option.disabledReason)
    .map(
      option =>
        `${option.version} (${option.type}${option.version === preparation.suggestedVersion ? ', suggested' : ''})`
    )
    .join(', ')
}

/* A non-interactive publish: the first release is always 1.0.0 with empty
   notes; later releases default to the suggested version and need notes. */
export function resolvePublishRequest(
  preparation: PublishPreparation,
  input: { version?: string; agencyNotes?: string; subAccountNotes?: string }
): PublishRequest {
  if (preparation.baseVersion === undefined) {
    if (input.version !== undefined && input.version !== FIRST_VERSION) {
      throw new CodedError('INVALID_INPUT', `The first published version is always ${FIRST_VERSION}.`)
    }
    return {
      newVersion: FIRST_VERSION,
      agencyNotes: input.agencyNotes ?? '',
      subAccountNotes: input.subAccountNotes ?? ''
    }
  }
  const newVersion = input.version ?? preparation.suggestedVersion
  if (!newVersion) throw new CodedError('INVALID_INPUT', `Choose a version: ${allowedVersions(preparation)}.`)
  const check = validateNewVersion(newVersion, preparation.options)
  if (check !== true) throw new CodedError('INVALID_INPUT', check)
  if (!input.agencyNotes?.trim()) {
    throw new CodedError('INVALID_INPUT', `Release notes for agencies are required to publish ${newVersion}.`)
  }
  if (input.subAccountNotes !== undefined && !input.subAccountNotes.trim()) {
    throw new CodedError('INVALID_INPUT', 'Sub-account release notes cannot be blank when provided.')
  }
  return { newVersion, agencyNotes: input.agencyNotes, subAccountNotes: input.subAccountNotes ?? '' }
}

/* Brings a workspace bound to the released version up to date, and follows a
   new version id in the stored selection. */
async function synchronizeLifecycle(
  target: ReleaseTarget,
  directory: string | undefined,
  expectedVersion: string,
  outcome: string
): Promise<void> {
  if (!directory) return
  try {
    const refreshed = await refreshAppWorkspaceLifecycle(
      directory,
      target.client,
      target.selected.appId,
      target.selected.versionId,
      expectedVersion
    )
    if (refreshed && refreshed.version._id !== target.selected.versionId) {
      await persistSelection(target.client, target.config, {
        appId: target.selected.appId,
        versionId: refreshed.version._id,
        name: refreshed.version.name ?? target.selected.name
      })
    }
  } catch (error) {
    throw new Error(
      `${outcome}, but the local workspace status could not be synchronized: ${errorMessage(error, 'local synchronization failed')} ` +
        'Run `ghl app pull` before making more local changes.'
    )
  }
}

export async function executePublish(
  target: ReleaseTarget,
  preparation: PublishPreparation,
  request: PublishRequest,
  directory?: string
): Promise<void> {
  await target.client.publishVersion(target.selected.appId, target.selected.versionId, request)
  const outcome = preparation.isPrivate
    ? `Version ${request.newVersion} was published`
    : `Version ${request.newVersion} was submitted for review`
  await synchronizeLifecycle(target, directory, request.newVersion, outcome)
}

export async function withdrawFromReview(target: ReleaseTarget, directory?: string): Promise<void> {
  requireVersionStatus(target.version.status, REVIEW_STATUSES, 'withdraw')
  await target.client.withdrawReview(target.selected.appId, target.selected.versionId)
  await synchronizeLifecycle(target, directory, 'draft', 'The version was withdrawn')
}

/* Returns the new draft's version id, which the stored selection follows. */
export async function createDraftFromLive(target: ReleaseTarget): Promise<string> {
  requireVersionStatus(target.version.status, ['live'], 'create a draft from')
  requireDraftable(await target.client.listVersions(target.selected.appId), target.selected.versionId)
  const created = await target.client.cloneAsDraft(target.selected.appId, target.selected.versionId)
  await persistSelection(target.client, target.config, { ...target.selected, versionId: created.id })
  return created.id
}

/* Same gating as the portal's Deprecate action: keep the newest live
   version, keep at least one live version, respect the active cap. */
export async function prepareDeprecation(target: ReleaseTarget): Promise<VersionListItem[]> {
  requireVersionStatus(target.version.status, ['live'], 'schedule deprecation for')
  const versions = await target.client.listVersions(target.selected.appId)
  requireDeprecatable(versions, target.selected.versionId)
  return versions
}

export function validateTimezone(timezone: string): true | string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    return true
  } catch {
    return `"${timezone}" is not a valid IANA timezone.`
  }
}

export function validateDeprecationRequest(request: DeprecationRequest): DeprecationRequest {
  const timezone = validateTimezone(request.timezone)
  if (timezone !== true) throw new CodedError('INVALID_INPUT', timezone)
  const date = validateDeprecationDate(request.date)
  if (date !== true) throw new CodedError('INVALID_INPUT', date)
  if (!request.notes.trim()) throw new CodedError('INVALID_INPUT', 'Deprecation notes cannot be empty.')
  return request
}

export async function executeDeprecation(target: ReleaseTarget, request: DeprecationRequest): Promise<void> {
  await target.client.scheduleDeprecation(target.selected.appId, target.selected.versionId, {
    deprecateDate: request.date,
    timezone: request.timezone,
    deprecationNotes: request.notes
  })
}

/* The portal never asks for a timezone; it sends the local one. */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}

/* The newest live version, or an error naming the app's versions when none
   is live (the API itself answers with a bare 404). */
export async function latestLiveVersion(client: ApiClient, appId: string): Promise<AppVersion> {
  const versions = await client.listVersions(appId)
  if (!versions.some(version => normalizeStatus(version.status) === 'live')) {
    const states = versions.map(version => `${version.version ?? 'unversioned'} ${version.status ?? ''}`.trim())
    throw new CodedError('INVALID_STATE', `The app has no live version (versions: ${states.join(', ') || 'none'}).`)
  }
  return client.getLatestVersion(appId, true)
}

/* A security review applies to the live version of a private app with
   enough agency installs; returns that live version once it qualifies. */
export async function prepareSecurityReview(
  client: ApiClient,
  appId: string,
  agencyInstallCount: number
): Promise<AppVersion> {
  const liveVersion = await latestLiveVersion(client, appId)
  requireSecurityReviewEligible(liveVersion, agencyInstallCount)
  await assertReadiness(client, appId, liveVersion, 'private')
  return liveVersion
}
