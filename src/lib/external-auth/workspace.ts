import { promises as fs } from 'node:fs'
import path from 'node:path'

import { isRecord, sanitizeTerminalText } from '../api/response.js'
import { writeWorkspaceDocumentation } from '../app/instructions.js'
import { requireRegularFile } from '../app/local-workspace.js'
import { AppManifest } from '../app/manifest.js'
import { readPullWorkspaceBinding } from '../app/pull.js'
import { APP_MANIFEST_FILENAME } from '../app/workspace.js'
import { readJsonFile, writeJsonFileAtomic } from '../shared/json-file.js'
import { writeTextFileAtomic } from '../shared/atomic-file.js'
import { changedValuePaths } from '../shared/three-way-diff.js'
import { buildExternalAuthGuide, EXTERNAL_AUTH_GUIDE_FILENAME } from './guide.js'
import {
  ExternalAuthCapabilityLocks,
  ExternalAuthManifest
} from './manifest.js'
import { validateExternalAuthManifest } from './schema.js'

export { EXTERNAL_AUTH_GUIDE_FILENAME }
export const EXTERNAL_AUTH_DIRECTORY_RELATIVE_PATH = path.join('src', 'external-auth')
export const EXTERNAL_AUTH_CONFIG_RELATIVE_PATH = path.join(EXTERNAL_AUTH_DIRECTORY_RELATIVE_PATH, 'config.json')
export const EXTERNAL_AUTH_STATE_RELATIVE_PATH = path.join('.ghl', 'external-auth-state.json')

export interface ExternalAuthState {
  schemaVersion: 1
  appId: string
  versionId: string
  baseline: ExternalAuthManifest
  capabilityLocks: ExternalAuthCapabilityLocks
}

export interface ExternalAuthWorkspace {
  directory: string
  app: Pick<AppManifest, 'appId' | 'versionId' | 'status'>
  manifest: ExternalAuthManifest
  state: ExternalAuthState
  configFile: string
  guideFile: string
  stateFile: string
}

export interface ExternalAuthWorkspaceResult {
  directory: string
  configFile: string
  guideFile: string
  stateFile: string
}

interface ExternalAuthBinding {
  directory: string
  app: ExternalAuthWorkspace['app']
}

const STATE_KEYS = new Set(['schemaVersion', 'appId', 'versionId', 'baseline', 'capabilityLocks'])
const LOCK_KEYS = new Set([
  'hasWhoAmIApiDisableLocked',
  'multiAuthEnabledDisableLocked',
  'authTypeLocked',
  'lockedAuthType',
  'oauth2TypeLocked'
])
const UNLOCKED_CAPABILITIES: ExternalAuthCapabilityLocks = {
  hasWhoAmIApiDisableLocked: false,
  multiAuthEnabledDisableLocked: false,
  authTypeLocked: false,
  oauth2TypeLocked: false
}

async function lstatIfPresent(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function requireSafeDirectory(directory: string, label: string, optional = false): Promise<boolean> {
  const stat = await lstatIfPresent(directory)
  if (!stat) {
    if (optional) return false
    throw new Error(`${label} "${directory}" does not exist.`)
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} "${directory}" cannot be a symbolic link.`)
  if (!stat.isDirectory()) throw new Error(`${label} "${directory}" is not a directory.`)
  return true
}

async function loadBinding(inputDirectory: string): Promise<ExternalAuthBinding> {
  const binding = await readPullWorkspaceBinding(inputDirectory)
  if (!binding) {
    throw new Error(
      `No ${APP_MANIFEST_FILENAME} was found in "${path.resolve(inputDirectory)}" or a parent directory. ` +
        'Run this command inside an app workspace or pass `--directory <app-folder>`.'
    )
  }
  await requireSafeDirectory(binding.directory, 'App workspace')
  const appFile = path.join(binding.directory, APP_MANIFEST_FILENAME)
  const value = await readJsonFile<unknown>(appFile)
  if (!isRecord(value)) throw new Error(`App manifest "${appFile}" must contain a JSON object.`)
  if (typeof value.status !== 'string' || !value.status) {
    throw new Error('App manifest is missing external-auth prerequisite status. Run `ghl app pull` again.')
  }
  return {
    directory: binding.directory,
    app: { appId: binding.appId, versionId: binding.versionId, status: value.status }
  }
}

function assertBinding(binding: ExternalAuthBinding, manifest: ExternalAuthManifest, label = 'config.json'): void {
  if (manifest.appId !== binding.app.appId) {
    throw new Error(`${label} belongs to app "${manifest.appId}", not "${binding.app.appId}".`)
  }
  if (manifest.versionId !== binding.app.versionId) {
    throw new Error(`${label} belongs to version "${manifest.versionId}", not "${binding.app.versionId}".`)
  }
}

function validateManifest(
  manifest: unknown,
  locks: Partial<ExternalAuthCapabilityLocks>,
  label = 'External auth configuration'
): asserts manifest is ExternalAuthManifest {
  const errors = validateExternalAuthManifest(manifest, locks)
  if (errors.length > 0) throw new Error(`${label} is invalid:\n- ${errors.join('\n- ')}`)
}

function validateState(binding: ExternalAuthBinding, value: unknown): asserts value is ExternalAuthState {
  if (!isRecord(value)) throw new Error('.ghl/external-auth-state.json must contain an object.')
  const errors: string[] = []
  for (const key of Object.keys(value)) {
    if (!STATE_KEYS.has(key)) errors.push(`.ghl/external-auth-state.json.${key} is not supported.`)
  }
  if (value.schemaVersion !== 1) errors.push('.ghl/external-auth-state.json.schemaVersion must be 1.')
  if (value.appId !== binding.app.appId || value.versionId !== binding.app.versionId) {
    errors.push('.ghl/external-auth-state.json does not match this app and version.')
  }
  if (!isRecord(value.capabilityLocks)) {
    errors.push('.ghl/external-auth-state.json.capabilityLocks must be an object.')
  } else {
    for (const key of Object.keys(value.capabilityLocks)) {
      if (!LOCK_KEYS.has(key)) errors.push(`.ghl/external-auth-state.json.capabilityLocks.${key} is not supported.`)
    }
    for (const key of ['hasWhoAmIApiDisableLocked', 'multiAuthEnabledDisableLocked']) {
      if (typeof value.capabilityLocks[key] !== 'boolean') {
        errors.push(`.ghl/external-auth-state.json.capabilityLocks.${key} must be a boolean.`)
      }
    }
    if (value.capabilityLocks.authTypeLocked !== undefined && typeof value.capabilityLocks.authTypeLocked !== 'boolean') {
      errors.push('.ghl/external-auth-state.json.capabilityLocks.authTypeLocked must be a boolean.')
    }
    if (
      value.capabilityLocks.lockedAuthType !== undefined &&
      value.capabilityLocks.lockedAuthType !== 'basic' &&
      value.capabilityLocks.lockedAuthType !== 'oauth2'
    ) {
      errors.push('.ghl/external-auth-state.json.capabilityLocks.lockedAuthType must be "basic" or "oauth2".')
    }
    if (value.capabilityLocks.authTypeLocked === true && value.capabilityLocks.lockedAuthType === undefined) {
      errors.push('.ghl/external-auth-state.json.capabilityLocks.lockedAuthType is required when authTypeLocked is true.')
    }
    if (value.capabilityLocks.oauth2TypeLocked !== undefined && typeof value.capabilityLocks.oauth2TypeLocked !== 'boolean') {
      errors.push('.ghl/external-auth-state.json.capabilityLocks.oauth2TypeLocked must be a boolean.')
    }
  }
  errors.push(...validateExternalAuthManifest(value.baseline).map(error =>
    error.replace(/^config\.json/, '.ghl/external-auth-state.json.baseline')
  ))
  if (errors.length > 0) throw new Error(`External auth state is invalid:\n- ${errors.join('\n- ')}`)
}

async function assertManagedPathsSafe(binding: ExternalAuthBinding): Promise<void> {
  const directory = path.join(binding.directory, EXTERNAL_AUTH_DIRECTORY_RELATIVE_PATH)
  if (await requireSafeDirectory(directory, 'External auth directory', true)) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`External auth path "${sanitizeTerminalText(entryPath)}" cannot be a symbolic link.`)
      }
      if (entry.name.endsWith('.json') && entry.name !== 'config.json') {
        throw new Error(`External auth JSON file "${sanitizeTerminalText(entryPath)}" is not supported.`)
      }
    }
  }
  await Promise.all([
    requireRegularFile(path.join(binding.directory, EXTERNAL_AUTH_CONFIG_RELATIVE_PATH), 'External auth manifest', true),
    requireRegularFile(
      path.join(binding.directory, EXTERNAL_AUTH_DIRECTORY_RELATIVE_PATH, EXTERNAL_AUTH_GUIDE_FILENAME),
      'External auth guide',
      true
    ),
    requireRegularFile(path.join(binding.directory, EXTERNAL_AUTH_STATE_RELATIVE_PATH), 'External auth state', true)
  ])
}

export async function writeExternalAuthWorkspace(
  inputDirectory: string,
  manifest: ExternalAuthManifest,
  baseline: ExternalAuthManifest = manifest,
  capabilityLocks: ExternalAuthCapabilityLocks = UNLOCKED_CAPABILITIES
): Promise<ExternalAuthWorkspaceResult> {
  const binding = await loadBinding(inputDirectory)
  validateManifest(manifest, UNLOCKED_CAPABILITIES)
  validateManifest(baseline, UNLOCKED_CAPABILITIES, 'External auth baseline')
  assertBinding(binding, manifest)
  assertBinding(binding, baseline, 'External auth baseline')
  await assertManagedPathsSafe(binding)
  const externalAuthDirectory = path.join(binding.directory, EXTERNAL_AUTH_DIRECTORY_RELATIVE_PATH)
  const configFile = path.join(binding.directory, EXTERNAL_AUTH_CONFIG_RELATIVE_PATH)
  const guideFile = path.join(externalAuthDirectory, EXTERNAL_AUTH_GUIDE_FILENAME)
  const stateFile = path.join(binding.directory, EXTERNAL_AUTH_STATE_RELATIVE_PATH)
  const state: ExternalAuthState = {
    schemaVersion: 1,
    appId: binding.app.appId,
    versionId: binding.app.versionId,
    baseline,
    capabilityLocks
  }
  await fs.mkdir(externalAuthDirectory, { recursive: true, mode: 0o755 })
  await Promise.all([
    writeJsonFileAtomic(configFile, manifest, 0o644),
    writeTextFileAtomic(guideFile, buildExternalAuthGuide(), 0o644),
    writeJsonFileAtomic(stateFile, state, 0o600),
    writeWorkspaceDocumentation(binding.directory)
  ])
  return { directory: binding.directory, configFile, guideFile, stateFile }
}

export async function assertExternalAuthWorkspaceWritable(
  inputDirectory: string,
  manifest?: ExternalAuthManifest
): Promise<void> {
  const binding = await loadBinding(inputDirectory)
  if (manifest) {
    validateManifest(manifest, UNLOCKED_CAPABILITIES)
    assertBinding(binding, manifest)
  }
  await assertManagedPathsSafe(binding)
}

export async function loadExternalAuthWorkspace(inputDirectory: string): Promise<ExternalAuthWorkspace> {
  const binding = await loadBinding(inputDirectory)
  await assertManagedPathsSafe(binding)
  const configFile = path.join(binding.directory, EXTERNAL_AUTH_CONFIG_RELATIVE_PATH)
  const guideFile = path.join(binding.directory, EXTERNAL_AUTH_DIRECTORY_RELATIVE_PATH, EXTERNAL_AUTH_GUIDE_FILENAME)
  const stateFile = path.join(binding.directory, EXTERNAL_AUTH_STATE_RELATIVE_PATH)
  if (!await lstatIfPresent(stateFile)) {
    throw new Error('External-auth conflict state is missing. Run `ghl app external-auth pull` before editing external auth.')
  }
  await Promise.all([
    requireRegularFile(configFile, 'External auth manifest'),
    requireRegularFile(stateFile, 'External auth state')
  ])
  const [manifestValue, stateValue] = await Promise.all([
    readJsonFile<unknown>(configFile),
    readJsonFile<unknown>(stateFile)
  ])
  validateState(binding, stateValue)
  validateManifest(manifestValue, UNLOCKED_CAPABILITIES)
  const localChanges = changedValuePaths(stateValue.baseline, manifestValue)
    .filter(field => !['schemaVersion', 'appId', 'versionId'].includes(field))
  if (localChanges.length > 0) validateManifest(manifestValue, stateValue.capabilityLocks)
  assertBinding(binding, manifestValue)
  assertBinding(binding, stateValue.baseline, 'External auth baseline')
  return {
    directory: binding.directory,
    app: binding.app,
    manifest: manifestValue,
    state: stateValue,
    configFile,
    guideFile,
    stateFile
  }
}

export async function loadExternalAuthWorkspaceIfPresent(
  inputDirectory: string
): Promise<ExternalAuthWorkspace | undefined> {
  const binding = await readPullWorkspaceBinding(inputDirectory)
  if (!binding) return undefined
  const paths = [EXTERNAL_AUTH_CONFIG_RELATIVE_PATH, EXTERNAL_AUTH_STATE_RELATIVE_PATH]
  const stats = await Promise.all(paths.map(relativePath => lstatIfPresent(path.join(binding.directory, relativePath))))
  if (stats.every(value => !value)) return undefined
  return loadExternalAuthWorkspace(binding.directory)
}
