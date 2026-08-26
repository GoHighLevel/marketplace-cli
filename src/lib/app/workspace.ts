import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { AppVersion } from '../api/client.js'
import {
  AGENTS_FILENAME,
  assertWorkspaceDocumentationFilesWritable,
  CLAUDE_FILENAME,
  HIGHLEVEL_APP_FILENAME,
  writeWorkspaceDocumentation
} from './instructions.js'
import { AppFiles, AppManifest, buildAppFiles, WebhookManifest } from './manifest.js'
import { readJsonFile, writeJsonFileAtomic } from '../shared/json-file.js'
import { removeEmptyDirectoryTree, removeRegularFileIfPresent } from '../shared/workspace-files.js'

export const APP_MANIFEST_FILENAME = 'ghl-app.json'
export const WEBHOOK_MANIFEST_FILENAME = 'ghl-webhooks.json'
export const WEBHOOK_MANIFEST_RELATIVE_PATH = path.join('src', 'webhooks', WEBHOOK_MANIFEST_FILENAME)
export const WORKSPACE_STATE_RELATIVE_PATH = path.join('.ghl', 'state.json')
export { AGENTS_FILENAME, CLAUDE_FILENAME, HIGHLEVEL_APP_FILENAME }

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const INVALID_FOLDER_CHARACTER = /[<>:"/\\|?*\u0000-\u001F]/
const MAX_FOLDER_NAME_LENGTH = 100

export interface AppWorkspaceResult {
  directory: string
  appFile: string
  webhookFile?: string
  stateFile: string
}

export interface WorkspaceState {
  schemaVersion: 1
  appId: string
  versionId: string
  baseline: AppFiles
}

export interface WriteAppWorkspaceOptions {
  directory: string
  version: AppVersion
}

export function validateAppFolderName(folder: string): true | string {
  if (folder.length === 0 || folder.trim().length === 0) return 'App folder name is required.'
  if (folder !== folder.trim()) return 'App folder name cannot start or end with whitespace.'
  if (folder === '.' || folder === '..' || INVALID_FOLDER_CHARACTER.test(folder)) {
    return 'App folder name must be one safe directory name without path separators.'
  }
  if (folder.endsWith('.')) return 'App folder name cannot end with a period.'
  if (folder.length > MAX_FOLDER_NAME_LENGTH) {
    return `App folder name must be at most ${MAX_FOLDER_NAME_LENGTH} characters.`
  }
  if (WINDOWS_RESERVED_NAME.test(folder)) return `App folder name "${folder}" is reserved by the operating system.`
  return true
}

export function slugifyAppName(name: string, appId?: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_FOLDER_NAME_LENGTH)
    .replace(/-+$/g, '')
  if (slug && !WINDOWS_RESERVED_NAME.test(slug)) return slug
  const suffix = appId?.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toLowerCase()
  return suffix ? `ghl-app-${suffix}` : 'ghl-app'
}

export function resolveAppDirectory(parentDirectory: string, folder: string): string {
  const validation = validateAppFolderName(folder)
  if (validation !== true) throw new Error(validation)
  if (!parentDirectory.trim()) throw new Error('Parent directory is required.')
  const parent = path.resolve(parentDirectory)
  const target = path.resolve(parent, folder)
  if (path.dirname(target) !== parent) throw new Error('App folder name must stay inside the selected parent directory.')
  return target
}

async function statIfPresent(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function assertWritableDirectoryPath(target: string, label: string): Promise<boolean> {
  const stat = await statIfPresent(target)
  if (!stat) return false
  if (stat.isSymbolicLink()) throw new Error(`${label} "${target}" cannot be a symbolic link.`)
  if (!stat.isDirectory()) throw new Error(`${label} "${target}" is not a directory.`)
  return true
}

export async function assertAppDirectoryAvailable(directory: string, expectedAppId?: string): Promise<void> {
  const parent = path.dirname(directory)
  const parentStat = await statIfPresent(parent)
  if (!parentStat) throw new Error(`Parent directory "${parent}" does not exist.`)
  if (!parentStat.isDirectory()) throw new Error(`Parent path "${parent}" is not a directory.`)

  const targetStat = await statIfPresent(directory)
  if (!targetStat) return
  if (targetStat.isSymbolicLink()) throw new Error(`App workspace "${directory}" cannot be a symbolic link.`)
  if (!targetStat.isDirectory()) throw new Error(`App workspace path "${directory}" is not a directory.`)

  const entries = await fs.readdir(directory)
  if (entries.length === 0) return
  const manifestPath = path.join(directory, APP_MANIFEST_FILENAME)
  const manifest = await readJsonFile<Partial<AppManifest>>(manifestPath)
  if (!manifest || typeof manifest.appId !== 'string' || !manifest.appId) {
    throw new Error(`Folder "${directory}" is not an app workspace and is not empty. Choose another folder.`)
  }
  if (!expectedAppId) {
    throw new Error(`Folder "${directory}" already contains an app workspace. Choose another folder.`)
  }
  if (manifest.appId !== expectedAppId) {
    throw new Error(`Folder "${directory}" belongs to app "${manifest.appId}", not "${expectedAppId}".`)
  }
}

async function writeFiles(directory: string, options: WriteAppWorkspaceOptions): Promise<void> {
  await assertWorkspaceDocumentationFilesWritable(directory)
  const files = buildAppFiles(options.version)
  const hasWebhooks = hasWebhookConfiguration(files.webhooks)
  const sourceDirectory = path.join(directory, 'src')
  const webhookFile = path.join(directory, WEBHOOK_MANIFEST_RELATIVE_PATH)
  const webhookDirectory = path.dirname(webhookFile)
  const stateDirectory = path.dirname(path.join(directory, WORKSPACE_STATE_RELATIVE_PATH))
  const sourceDirectoryExists = await assertWritableDirectoryPath(sourceDirectory, 'Source directory')
  const webhookDirectoryExists = await assertWritableDirectoryPath(webhookDirectory, 'Webhook directory')
  const stateDirectoryExists = await assertWritableDirectoryPath(stateDirectory, 'Workspace state directory')
  const state: WorkspaceState = {
    schemaVersion: 1,
    appId: files.app.appId,
    versionId: files.app.versionId,
    baseline: files
  }
  const writes: Array<Promise<void>> = [
    writeJsonFileAtomic(path.join(directory, APP_MANIFEST_FILENAME), files.app, 0o644),
    writeJsonFileAtomic(path.join(directory, WORKSPACE_STATE_RELATIVE_PATH), state, 0o600),
    writeWorkspaceDocumentation(directory)
  ]
  if (hasWebhooks) writes.push(writeJsonFileAtomic(webhookFile, files.webhooks, 0o644))
  await Promise.all(writes)
  if (hasWebhooks) {
    if (!sourceDirectoryExists) await fs.chmod(sourceDirectory, 0o755)
    if (!webhookDirectoryExists) await fs.chmod(webhookDirectory, 0o755)
  } else {
    await removeRegularFileIfPresent(webhookFile, 'Webhook manifest')
    await removeEmptyDirectoryTree(webhookDirectory, directory)
  }
  if (!stateDirectoryExists) await fs.chmod(stateDirectory, 0o700)
}

export function hasWebhookConfiguration(webhooks: Pick<WebhookManifest, 'webhookUrl' | 'subscribedEvents'>): boolean {
  return webhooks.webhookUrl.trim().length > 0 || webhooks.subscribedEvents.length > 0
}

async function legacyWebhookFileToMigrate(directory: string, appId: string): Promise<string | undefined> {
  const legacyFile = path.join(directory, WEBHOOK_MANIFEST_FILENAME)
  const legacyStat = await statIfPresent(legacyFile)
  if (!legacyStat) return undefined
  if (legacyStat.isSymbolicLink() || !legacyStat.isFile()) {
    throw new Error(`Legacy webhook path "${legacyFile}" is not a regular generated file.`)
  }
  const legacy = await readJsonFile<Partial<WebhookManifest>>(legacyFile)
  if (!legacy || legacy.appId !== appId) {
    if (typeof legacy?.appId === 'string' && legacy.appId) {
      throw new Error(
        `Legacy webhook file "${legacyFile}" belongs to app "${legacy.appId}", not "${appId}"; it was not removed.`
      )
    }
    throw new Error(`Legacy webhook file "${legacyFile}" cannot be verified for app "${appId}"; it was not removed.`)
  }
  return legacyFile
}

export async function writeAppWorkspace(options: WriteAppWorkspaceOptions): Promise<AppWorkspaceResult> {
  const appId = String(options.version.appId ?? options.version._id)
  await assertAppDirectoryAvailable(options.directory, appId)
  const existing = await statIfPresent(options.directory)
  const legacyWebhookFile = existing
    ? await legacyWebhookFileToMigrate(options.directory, appId)
    : undefined

  if (existing) {
    await writeFiles(options.directory, options)
    if (legacyWebhookFile) await fs.unlink(legacyWebhookFile)
  } else {
    const parent = path.dirname(options.directory)
    const stage = path.join(parent, `.ghl-app-${randomUUID()}.stage`)
    try {
      await fs.mkdir(stage, { mode: 0o755 })
      await writeFiles(stage, options)
      await fs.chmod(stage, 0o755)
      await fs.rename(stage, options.directory)
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  const webhookFile = path.join(options.directory, WEBHOOK_MANIFEST_RELATIVE_PATH)
  const result: AppWorkspaceResult = {
    directory: options.directory,
    appFile: path.join(options.directory, APP_MANIFEST_FILENAME),
    stateFile: path.join(options.directory, WORKSPACE_STATE_RELATIVE_PATH)
  }
  if (hasWebhookConfiguration(buildAppFiles(options.version).webhooks)) result.webhookFile = webhookFile
  return result
}
