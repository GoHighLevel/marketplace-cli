import { promises as fs } from 'node:fs'
import path from 'node:path'

import { AppFiles, AppManifest, WebhookManifest } from './manifest.js'
import {
  APP_MANIFEST_FILENAME,
  WEBHOOK_MANIFEST_RELATIVE_PATH,
  WORKSPACE_STATE_RELATIVE_PATH,
  WorkspaceState
} from './workspace.js'
import { readJsonFile } from '../shared/json-file.js'

const MAX_MANAGED_FILE_BYTES = 2 * 1024 * 1024

export interface LocalAppWorkspace {
  directory: string
  appFile: string
  webhookFile: string
  stateFile: string
  files: AppFiles
  state: WorkspaceState
}

export async function requireRegularFile(filePath: string, label: string, optional = false): Promise<boolean> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>
  try {
    stat = await fs.lstat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (optional) return false
      const recovery = label === 'Workspace state' ? ' Pull the app again with `ghl app pull` to initialize it.' : ''
      throw new Error(`${label} is missing at "${filePath}".${recovery}`)
    }
    throw error
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} "${filePath}" cannot be a symbolic link.`)
  if (!stat.isFile()) throw new Error(`${label} "${filePath}" is not a regular file.`)
  if (stat.size > MAX_MANAGED_FILE_BYTES) {
    throw new Error(`${label} "${filePath}" is too large; managed JSON files must be at most 2 MiB.`)
  }
  return true
}

async function requireSafeDirectory(directory: string, label: string, optional = false): Promise<boolean> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>
  try {
    stat = await fs.lstat(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (optional) return false
      throw new Error(`${label} "${directory}" does not exist.`)
    }
    throw error
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} "${directory}" cannot be a symbolic link.`)
  if (!stat.isDirectory()) throw new Error(`${label} "${directory}" is not a directory.`)
  return true
}

export async function readLocalAppWorkspace(inputDirectory: string): Promise<LocalAppWorkspace> {
  const directory = path.resolve(inputDirectory)
  const appFile = path.join(directory, APP_MANIFEST_FILENAME)
  const webhookFile = path.join(directory, WEBHOOK_MANIFEST_RELATIVE_PATH)
  const stateFile = path.join(directory, WORKSPACE_STATE_RELATIVE_PATH)

  await requireSafeDirectory(directory, 'App workspace')
  await requireRegularFile(appFile, 'App manifest (ghl-app.json)')
  const sourceDirectoryExists = await requireSafeDirectory(path.join(directory, 'src'), 'Source directory', true)
  if (sourceDirectoryExists) await requireSafeDirectory(path.dirname(webhookFile), 'Webhook directory', true)
  await requireSafeDirectory(path.dirname(stateFile), 'Workspace state directory')
  const [webhookFileExists] = await Promise.all([
    requireRegularFile(webhookFile, 'Webhook manifest', true),
    requireRegularFile(stateFile, 'Workspace state')
  ])

  const [app, storedWebhooks, state] = await Promise.all([
    readJsonFile<AppManifest>(appFile),
    webhookFileExists ? readJsonFile<WebhookManifest>(webhookFile) : undefined,
    readJsonFile<WorkspaceState>(stateFile)
  ])
  if (!app || (webhookFileExists && !storedWebhooks) || !state) {
    throw new Error(`App workspace "${directory}" contains an unreadable managed file.`)
  }
  const webhooks: WebhookManifest = storedWebhooks ?? {
    schemaVersion: 1,
    appId: app.appId,
    versionId: app.versionId,
    webhookUrl: '',
    subscribedEvents: []
  }

  return {
    directory,
    appFile,
    webhookFile,
    stateFile,
    files: { app, webhooks },
    state
  }
}
