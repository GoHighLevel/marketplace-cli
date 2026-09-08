import path from 'node:path'

import { AppVersion, VersionListItem } from '../api/client.js'
import type { BillingWorkspaceResult } from '../billing/workspace.js'
import type { ExternalAuthWorkspaceResult } from '../external-auth/workspace.js'
import { isRecord } from '../api/response.js'
import { requireRegularFile } from './local-workspace.js'
import { APP_MANIFEST_FILENAME, AppWorkspaceResult } from './workspace.js'
import { isAppResourceIdentifier } from './schema.js'
import { readJsonFile } from '../shared/json-file.js'
import type { WorkflowActionsWorkspaceResult } from '../workflows/actions/workspace.js'
import type { WorkflowTriggersWorkspaceResult } from '../workflows/triggers/workspace.js'

export interface PullWorkspaceBinding {
  directory: string
  appId: string
  versionId: string
  name?: string
}

export interface AppExportClient {
  getVersion(appId: string, versionId: string): Promise<AppVersion>
}

export function buildPullFilesOutput(options: {
  app: AppWorkspaceResult
  actions?: WorkflowActionsWorkspaceResult
  triggers?: WorkflowTriggersWorkspaceResult
  billing?: BillingWorkspaceResult
  externalAuth?: ExternalAuthWorkspaceResult
}): Record<string, unknown> {
  const { guideFile: actionGuideFile, stateFile: workflowActionStateFile, ...actionFiles } = options.actions ?? {}
  const { guideFile: billingGuideFile, stateFile: billingStateFile, ...billingFiles } = options.billing ?? {}
  const {
    guideFile: externalAuthGuideFile,
    stateFile: externalAuthStateFile,
    ...externalAuthFiles
  } = options.externalAuth ?? {}
  return {
    ...options.app,
    ...(options.actions ? { ...actionFiles, actionGuideFile, workflowActionStateFile } : {}),
    ...(options.triggers ?? {}),
    ...(options.billing ? { ...billingFiles, billingGuideFile, billingStateFile } : {}),
    ...(options.externalAuth ? { ...externalAuthFiles, externalAuthGuideFile, externalAuthStateFile } : {})
  }
}

function requireManifestIdentifier(manifest: Record<string, unknown>, property: 'appId' | 'versionId'): string {
  const value = manifest[property]
  if (!isAppResourceIdentifier(value)) {
    throw new Error(
      `App manifest "${APP_MANIFEST_FILENAME}" must contain a 1 to 128 character ${property} using only letters, numbers, underscores, or hyphens.`
    )
  }
  return value
}

export async function readPullWorkspaceBinding(inputDirectory: string): Promise<PullWorkspaceBinding | undefined> {
  let directory = path.resolve(inputDirectory)
  while (true) {
    const manifestPath = path.join(directory, APP_MANIFEST_FILENAME)
    if (await requireRegularFile(manifestPath, 'App manifest (ghl-app.json)', true)) {
      const manifest = await readJsonFile<unknown>(manifestPath)
      if (!isRecord(manifest)) throw new Error(`App manifest "${manifestPath}" must contain a JSON object.`)
      const basicInfo = isRecord(manifest.basicInfo) ? manifest.basicInfo : undefined
      const name = typeof basicInfo?.name === 'string' && basicInfo.name.trim() ? basicInfo.name : undefined
      return {
        directory,
        appId: requireManifestIdentifier(manifest, 'appId'),
        versionId: requireManifestIdentifier(manifest, 'versionId'),
        ...(name ? { name } : {})
      }
    }
    const parent = path.dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

export function resolvePullWorkspaceBinding(
  binding: PullWorkspaceBinding | undefined,
  requestedAppId?: string
): PullWorkspaceBinding | undefined {
  if (!binding) return undefined
  if (requestedAppId && requestedAppId !== binding.appId) {
    throw new Error(
      `The current workspace belongs to app "${binding.appId}", so app "${requestedAppId}" cannot be pulled into it. ` +
        'Pass `--directory <parent>` or `--folder <name>` to pull that app into another workspace.'
    )
  }
  return binding
}

export function resolveVersionId(
  versions: VersionListItem[],
  selector: string | undefined,
  selectedVersionId: string
): string {
  if (!selector) {
    if (versions.some(version => version._id === selectedVersionId)) return selectedVersionId
    throw new Error(
      `The selected version "${selectedVersionId}" is no longer available. ` +
        'Run `ghl app versions` and pull a version with `--version <id|version>`.'
    )
  }

  const match = versions.find(version => version._id === selector || version.version === selector)
  if (match) return match._id
  const available = versions.map(version => `${version.version ?? 'unversioned'} (${version._id})`).join(', ')
  throw new Error(
    `Version "${selector}" was not found for this app. Available versions: ${available || 'none'}.`
  )
}

export async function loadAppVersionForExport(
  client: AppExportClient,
  appId: string,
  versionId: string
): Promise<AppVersion> {
  const version = await client.getVersion(appId, versionId)
  if (version._id !== versionId) {
    throw new Error(`App version API returned version "${version._id}" instead of "${versionId}".`)
  }
  if (version.appId !== undefined && version.appId !== appId) {
    throw new Error(`App version API returned app "${version.appId}" instead of "${appId}".`)
  }
  return { ...version, appId }
}
