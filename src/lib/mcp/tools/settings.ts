import { z } from 'zod'

import { createClientKeyInLedger, deleteClientKeyAndSecret, requireClientKey } from '../../app/client-keys.js'
import {
  deleteMedia,
  locateAttachedMedia,
  type MediaProfile,
  type MediaUpload,
  type MediaUploadResult,
  uploadMedia,
  validateMediaUpload,
  withoutMedia
} from '../../app/media-sync.js'
import { type AppTarget, loadTargetContext } from '../../app/overview.js'
import type { AppContext } from '../../app/section-context.js'
import type { CliConfig } from '../../config/environment.js'
import { CodedError, errorMessage } from '../../shared/errors.js'
import { absolutePath, appId, required } from '../inputs.js'
import { portalClient } from '../portal.js'
import { oneLine } from '../text.js'
import { defineTool, textResult, type Toolset } from '../tool.js'
import { mediaFile } from './app-overview.js'

const PORTAL_WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const
const WORKSPACE_NOTE = 'An app workspace now lags behind these media fields; pull-app refreshes it.'

const appTarget = {
  appId: appId().optional().describe('Defaults to the app of directory, then the selected app.'),
  directory: absolutePath().optional().describe('App workspace whose app is used when appId is omitted.')
}

const mediaInput = {
  ...appTarget,
  logo: absolutePath().optional().describe('Image file to set as the logo.'),
  screenshots: z.array(absolutePath()).min(1).max(9).optional().describe('Image files to add as screenshots.'),
  profile: z.enum(['agency', 'sub-account']).default('agency').describe('Profile the screenshots belong to.'),
  remove: z
    .array(z.string().trim().min(1).max(2_048))
    .min(1)
    .max(20)
    .optional()
    .describe('Attached media to delete: file names from get-app, or URLs.')
}

const keysInput = {
  ...appTarget,
  action: z.enum(['create', 'delete', 'default']).describe('create a key, delete one, or make one the default.'),
  name: z.string().trim().min(1).max(100).optional().describe('create: a name for the key.'),
  keyId: z.string().trim().min(1).max(128).optional().describe('delete or default: the client key id from get-app.')
}

interface KeysRequest extends AppTarget {
  action: 'create' | 'delete' | 'default'
  name?: string
  keyId?: string
}

interface MediaRequest extends AppTarget {
  logo?: string
  screenshots?: string[]
  profile: MediaProfile
  remove?: string[]
}

/* Each step builds on the portal's latest copy, so a removal is never undone
   by the next upload. A step on a live version moves to its new draft. */
async function reloaded(context: AppContext): Promise<AppContext> {
  return { ...context, version: await context.client.getVersion(context.selected.appId, context.selected.versionId) }
}

/* get-app lists media by file name; each name maps back to the one
   attached URL that ends with it. */
function attachedUrls(context: AppContext, entries: readonly string[]): string[] {
  const { version } = context
  const attached = [
    version.logoUrl,
    ...(version.previewImageUrls ?? []),
    ...(version.subAccountPreviewImageUrls ?? [])
  ].filter((url): url is string => Boolean(url))
  return entries.map(entry => {
    if (attached.includes(entry)) return entry
    const matches = attached.filter(url => url.endsWith(`/${entry}`))
    return matches.length === 1 ? matches[0] : entry
  })
}

function uploadsOf(request: MediaRequest): MediaUpload[] {
  return [
    ...(request.logo ? [{ files: [request.logo], logo: true, profile: 'agency' as const }] : []),
    ...(request.screenshots ? [{ files: request.screenshots, logo: false, profile: request.profile }] : [])
  ]
}

/* Named as get-app names them, so a later removal needs no lookup. */
function fileNames(urls: readonly string[]): string {
  return urls.map(mediaFile).join(', ')
}

function uploadedLines(upload: MediaUpload, uploaded: MediaUploadResult): string[] {
  if (upload.logo) return [`Logo set: ${fileNames(uploaded.urls)}.`, ...uploaded.notes]
  return [
    ...(uploaded.subAccountProfileEnabled ? ['Enabled the sub-account profile with the agency description.'] : []),
    `Added ${fileNames(uploaded.urls)} to the ${upload.profile} profile.`,
    ...uploaded.notes
  ]
}

/* The result, so confirming it needs no get-app call. */
function mediaNow(context: AppContext): string {
  const { logoUrl, previewImageUrls, subAccountPreviewImageUrls } = context.version
  const agency = (previewImageUrls ?? []).length
  const subAccount = (subAccountPreviewImageUrls ?? []).length
  return `Media now: logo ${logoUrl ? mediaFile(logoUrl) : 'none'}; ${agency} agency and ${subAccount} sub-account screenshot(s).`
}

/* Everything is validated before the first change, because a deletion
   cannot be undone if a later upload would fail. */
async function updateMedia(config: CliConfig, request: MediaRequest): Promise<string> {
  const uploads = uploadsOf(request)
  if (uploads.length === 0 && !request.remove) {
    throw new CodedError('INVALID_INPUT', 'Pass logo, screenshots, or remove.')
  }
  let context = await loadTargetContext(await portalClient(config), config, request)
  const urls = request.remove ? attachedUrls(context, request.remove) : []
  const location = request.remove ? locateAttachedMedia(context, urls) : undefined
  const projected = location ? withoutMedia(context, location) : context
  for (const upload of uploads) await validateMediaUpload(projected, upload)

  const done: string[] = []
  try {
    if (location) {
      done.push(...(await deleteMedia(context, urls, location)), `Removed ${fileNames(urls)}.`)
      context = await reloaded(context)
    }
    for (const upload of uploads) {
      done.push(...uploadedLines(upload, await uploadMedia(context, upload)))
      context = await reloaded(context)
    }
  } catch (error) {
    if (done.length === 0) throw error
    throw new CodedError('PARTIAL', `${done.join(' ')} Then failed: ${errorMessage(error, 'the next step failed.')}`)
  }
  return [...done, mediaNow(context), WORKSPACE_NOTE].join('\n')
}

async function manageClientKeys(config: CliConfig, request: KeysRequest): Promise<string> {
  if (request.action === 'create') {
    const name = required(request.name, 'create needs a key name.')
    const id = await createClientKeyInLedger(await loadTargetContext(await portalClient(config), config, request), name)
    return `Created client key "${oneLine(name, 100)}" with client id ${oneLine(id, 128)}. Its secret is stored locally only; the user can view it once with \`ghl secrets reveal\`.`
  }
  const keyId = required(request.keyId, `${request.action} needs the keyId from get-app.`)
  const context = await loadTargetContext(await portalClient(config), config, request)
  if (request.action === 'delete') {
    const ledgerUpdated = await deleteClientKeyAndSecret(context, keyId)
    return `Deleted client key ${keyId}; integrations using it stop working.${ledgerUpdated ? '' : ' The local secrets ledger could not be updated.'}`
  }
  requireClientKey(context.version, keyId)
  if (context.version.defaults?.clientKey === keyId) return `Client key ${keyId} is already the default.`
  await context.client.makeClientKeyDefault(context.selected.appId, keyId)
  return `Client key ${keyId} is now the default.`
}

export function settingsToolset(config: CliConfig): Toolset {
  return {
    name: 'settings',
    instructions: [],
    tools: [
      defineTool({
        name: 'update-media',
        title: 'Update the app logo and screenshots',
        description:
          'Uploads an image as the app logo, adds screenshot images to the agency or sub-account profile, and deletes attached media, in one call. Applies to the portal directly.',
        input: mediaInput,
        annotations: PORTAL_WRITE,
        run: async request => textResult(await updateMedia(config, request))
      }),
      defineTool({
        name: 'manage-client-keys',
        title: 'Create, delete, or choose the default client key',
        description:
          'Creates an OAuth client key (its secret goes to the local secrets ledger, never to this conversation), deletes a key, or makes a key the default for the app.',
        input: keysInput,
        annotations: PORTAL_WRITE,
        run: async request => textResult(await manageClientKeys(config, request))
      })
    ]
  }
}
