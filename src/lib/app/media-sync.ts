import type { ProfileUpdateResult } from '../api/types.js'
import { CodedError, errorMessage } from '../shared/errors.js'
import { buildUploadForm, locateMedia, type MediaLocation, validateScreenshotCount } from './media.js'
import {
  buildBasicInfoBody,
  buildProfilesBody,
  validateBasicInfoBody,
  validateDescription
} from './profile-sections.js'
import { type AppContext, followVersionChangeNotes } from './section-context.js'

export type MediaProfile = 'agency' | 'sub-account'

export interface MediaUpload {
  files: string[]
  /* The logo takes exactly one file; otherwise the files are screenshots. */
  logo: boolean
  profile: MediaProfile
}

export interface MediaUploadResult {
  urls: string[]
  /* Screenshots now attached to the profile. */
  total?: number
  subAccountProfileEnabled: boolean
  /* What else happened, such as a move to a new draft version. */
  notes: string[]
}

/* Checks the portal applies to an upload, before any file is sent. */
function assertUploadAllowed(context: AppContext, upload: MediaUpload): { enableSubProfile: boolean } {
  const { version } = context
  if (upload.files.length === 0) throw new Error('Pass at least one image file.')
  if (upload.logo) {
    if (upload.files.length !== 1) throw new Error('--logo takes exactly one file.')
    if (version.appType === 'template') {
      throw new Error('Template app logos are managed with the template workflow and cannot be changed here.')
    }
    const basicInfo = validateBasicInfoBody(
      buildBasicInfoBody(version, { logoUrl: 'https://uploads.example.com/logo.png' }),
      version.isWhiteLabelFriendly ?? true
    )
    if (basicInfo !== true) throw new Error(`Complete basic info before uploading a logo: ${basicInfo}`)
    return { enableSubProfile: false }
  }
  const subAccount = upload.profile === 'sub-account'
  const enableSubProfile = subAccount && !version.hasSubAccountProfile
  if (enableSubProfile) {
    if ((version.subAccountPreviewImageUrls ?? []).length + upload.files.length < 3) {
      throw new Error(
        'The sub-account profile is not enabled yet and enabling it requires at least 3 screenshots. ' +
          'Upload enough files to reach 3 in a single command.'
      )
    }
    const description = validateDescription(version.subAccountDescription || version.description || '')
    if (description !== true) {
      throw new Error(
        `A valid agency description is required before the CLI can enable the sub-account profile: ${description} ` +
          'Set it with `ghl app profiles --description <text>` first.'
      )
    }
  }
  const current = subAccount ? version.subAccountPreviewImageUrls : version.previewImageUrls
  const count = validateScreenshotCount((current ?? []).length, upload.files.length)
  if (count !== true) throw new Error(count)
  return { enableSubProfile }
}

/* Every check an upload must pass, including reading and measuring the
   images, without sending anything. */
export async function validateMediaUpload(context: AppContext, upload: MediaUpload): Promise<void> {
  assertUploadAllowed(context, upload)
  await buildUploadForm(upload.files, upload.logo ? 'logo' : 'preview')
}

async function uploadFiles(context: AppContext, upload: MediaUpload): Promise<string[]> {
  const form = await buildUploadForm(upload.files, upload.logo ? 'logo' : 'preview')
  const urls = Object.values(await context.client.uploadFiles(context.selected.appId, form))
  if (urls.length === 0) throw new Error('Upload failed — no file URLs were returned.')
  if (urls.length === upload.files.length) return urls
  try {
    await context.client.deleteFiles(context.selected.appId, urls)
  } catch {
    throw new Error(
      `Upload returned ${urls.length} URL(s) for ${upload.files.length} file(s), and cleanup failed. ` +
        `Delete these files manually: ${urls.join(', ')}`
    )
  }
  throw new Error(
    `Upload returned ${urls.length} URL(s) for ${upload.files.length} file(s); partial uploads were removed.`
  )
}

async function attach(
  context: AppContext,
  upload: MediaUpload,
  urls: string[],
  enableSubProfile: boolean
): Promise<{ total?: number; result: ProfileUpdateResult }> {
  const { version, client, selected } = context
  if (upload.logo) {
    const body = buildBasicInfoBody(version, { logoUrl: urls[0] })
    return { result: await client.updateProfileSection('basicInfo', selected.appId, selected.versionId, body) }
  }
  const subAccount = upload.profile === 'sub-account'
  const next = [...((subAccount ? version.subAccountPreviewImageUrls : version.previewImageUrls) ?? []), ...urls]
  const description = version.subAccountDescription || version.description || ''
  const changes = subAccount
    ? {
        subAccountPreviewImageUrls: next,
        ...(enableSubProfile ? { hasSubAccountProfile: true, subAccountDescription: description } : {})
      }
    : { previewImageUrls: next }
  const body = buildProfilesBody(version, changes)
  return {
    total: next.length,
    result: await client.updateProfileSection('appProfiles', selected.appId, selected.versionId, body)
  }
}

/* Uploads the files and attaches them as the logo or as screenshots; files
   the portal refused to attach are removed again. Following a move to a new
   draft happens only after the attach succeeded, so attached files are never
   deleted. */
export async function uploadMedia(context: AppContext, upload: MediaUpload): Promise<MediaUploadResult> {
  const { enableSubProfile } = assertUploadAllowed(context, upload)
  const urls = await uploadFiles(context, upload)
  let attached: { total?: number; result: ProfileUpdateResult }
  try {
    attached = await attach(context, upload, urls, enableSubProfile)
  } catch (error) {
    const message = errorMessage(error, 'Failed to attach uploaded media.')
    try {
      await context.client.deleteFiles(context.selected.appId, urls)
    } catch {
      throw new Error(`${message} Cleanup also failed; the uploaded files may need manual deletion: ${urls.join(', ')}`)
    }
    throw new Error(`${message} The uploaded files were removed.`)
  }
  const notes = await followVersionChangeNotes(context, attached.result)
  return {
    urls,
    ...(attached.total === undefined ? {} : { total: attached.total }),
    subAccountProfileEnabled: enableSubProfile,
    notes
  }
}

export function locateAttachedMedia(context: AppContext, urls: string[]): MediaLocation {
  const location = locateMedia(urls, context.version)
  if (location.unknown.length > 0) {
    throw new CodedError('NOT_FOUND', `Not found on this app version: ${location.unknown.join(', ')}`)
  }
  return location
}

/* The version as it will be once the media is detached, so later uploads in
   the same request can be checked before anything is deleted. */
export function withoutMedia(context: AppContext, location: MediaLocation): AppContext {
  const { version } = context
  return {
    ...context,
    version: {
      ...version,
      logoUrl: location.logo ? '' : version.logoUrl,
      previewImageUrls: (version.previewImageUrls ?? []).filter(url => !location.agencyScreenshots.includes(url)),
      subAccountPreviewImageUrls: (version.subAccountPreviewImageUrls ?? []).filter(
        url => !location.subAccountScreenshots.includes(url)
      )
    }
  }
}

/* Detaches the media from the app, then deletes the files from storage.
   Returns notes such as a move to a new draft version. */
export async function deleteMedia(context: AppContext, urls: string[], location: MediaLocation): Promise<string[]> {
  const { client, version } = context
  const notes: string[] = []
  if (location.logo) {
    const body = buildBasicInfoBody(version, { logoUrl: '' })
    const result = await client.updateProfileSection(
      'basicInfo',
      context.selected.appId,
      context.selected.versionId,
      body
    )
    notes.push(...(await followVersionChangeNotes(context, result)))
  }
  if (location.agencyScreenshots.length > 0 || location.subAccountScreenshots.length > 0) {
    const detached = withoutMedia(context, { ...location, logo: false }).version
    const body = buildProfilesBody(version, {
      previewImageUrls: detached.previewImageUrls,
      subAccountPreviewImageUrls: detached.subAccountPreviewImageUrls
    })
    const result = await client.updateProfileSection(
      'appProfiles',
      context.selected.appId,
      context.selected.versionId,
      body
    )
    notes.push(...(await followVersionChangeNotes(context, result)))
  }
  try {
    await client.deleteFiles(context.selected.appId, urls)
  } catch (error) {
    throw new Error(
      `${errorMessage(error, 'Storage deletion failed.')} The media was detached from the app, but these files may require manual deletion: ${urls.join(', ')}`
    )
  }
  return notes
}
