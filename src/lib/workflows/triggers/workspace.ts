import { promises as fs } from 'node:fs'
import path from 'node:path'

import { isRecord } from '../../api/response.js'
import { writeTextFileAtomic } from '../../shared/atomic-file.js'
import {
  assertWorkspaceDocumentationFilesWritable,
  writeWorkspaceDocumentation
} from '../../app/instructions.js'
import { requireRegularFile } from '../../app/local-workspace.js'
import { readPullWorkspaceBinding } from '../../app/pull.js'
import { APP_MANIFEST_FILENAME } from '../../app/workspace.js'
import { readJsonFile, writeJsonFileAtomic } from '../../shared/json-file.js'
import {
  buildWorkflowTriggersGuide,
  WORKFLOW_TRIGGERS_GUIDE_FILENAME
} from './guide.js'
import { WorkflowTriggerDefinition, WorkflowTriggersManifest } from './manifest.js'
import { validateWorkflowTriggersManifest } from './schema.js'
import {
  workflowActionKeyValidationErrors,
  WORKFLOW_ACTION_KEY_MAX_LENGTH
} from '../actions/key.js'
import { removeEmptyDirectoryTree, removeRegularFileIfPresent } from '../../shared/workspace-files.js'

export const WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH = path.join('src', 'modules', 'workflows', 'triggers')
export const WORKFLOW_TRIGGERS_STATE_RELATIVE_PATH = path.join('.ghl', 'workflow-triggers-state.json')
export const LEGACY_WORKFLOW_TRIGGERS_RELATIVE_PATH = path.join('src', 'modules', 'workflows', 'workflow-triggers.json')

const TRIGGER_FILENAME_PATTERN = /^[a-z](?:[a-z0-9-]*[a-z0-9])?\.json$/
const TRIGGER_FILE_KEYS = new Set(['schemaVersion', 'key', 'templateId', 'versions'])

interface WorkflowTriggerFile {
  schemaVersion: 1
  key: string
  templateId?: string
  versions: WorkflowTriggerDefinition['versions']
}

export interface WorkflowTriggersState {
  schemaVersion: 1
  appId: string
  baseline: WorkflowTriggersManifest
}

export interface WorkflowTriggersWorkspace {
  directory: string
  allowedScopes: string[]
  redirectUris: string[]
  clientKeyCount: number
  userTypes: string[]
  triggerDirectory: string
  triggerFiles: string[]
  guideFile: string
  stateFile: string
  manifest: WorkflowTriggersManifest
  state: WorkflowTriggersState
}

export interface WorkflowTriggersWorkspaceResult {
  triggerDirectory: string
  triggerFiles: string[]
  triggerGuideFile: string
  triggerStateFile: string
}

interface WorkflowTriggersAppBinding {
  directory: string
  appId: string
  allowedScopes: string[]
  redirectUris: string[]
  clientKeyCount: number
  userTypes: string[]
  whiteLabel: boolean
}

async function stat(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function assertSafeDirectoryPath(directory: string, relativePath: string): Promise<void> {
  let current = directory
  for (const part of relativePath.split(path.sep)) {
    current = path.join(current, part)
    const currentStat = await stat(current)
    if (!currentStat) continue
    if (currentStat.isSymbolicLink()) throw new Error(`Workflow trigger path "${current}" cannot be a symbolic link.`)
    if (!currentStat.isDirectory()) throw new Error(`Workflow trigger path "${current}" is not a directory.`)
  }
}

async function assertWorkspacePathsSafe(binding: WorkflowTriggersAppBinding): Promise<void> {
  await requireRegularFile(path.join(binding.directory, APP_MANIFEST_FILENAME), 'App manifest (ghl-app.json)')
  await Promise.all([
    assertSafeDirectoryPath(binding.directory, WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH),
    assertSafeDirectoryPath(binding.directory, path.dirname(WORKFLOW_TRIGGERS_STATE_RELATIVE_PATH))
  ])
}

async function appBindingForWorkspace(inputDirectory: string): Promise<WorkflowTriggersAppBinding> {
  const workspace = await readPullWorkspaceBinding(inputDirectory)
  if (!workspace) {
    throw new Error(
      `No ${APP_MANIFEST_FILENAME} was found in "${path.resolve(inputDirectory)}" or a parent directory. ` +
        'Run this command inside an app workspace or pass `--directory <app-folder>`.'
    )
  }
  const appFile = path.join(workspace.directory, APP_MANIFEST_FILENAME)
  const app = await readJsonFile<unknown>(appFile)
  if (!isRecord(app)) throw new Error(`App manifest "${appFile}" must contain a JSON object.`)
  const listing = isRecord(app.listing) ? app.listing : undefined
  const oauth = isRecord(app.oauth) ? app.oauth : undefined
  return {
    directory: workspace.directory,
    appId: workspace.appId,
    allowedScopes: Array.isArray(oauth?.allowedScopes)
      ? oauth.allowedScopes.filter((scope): scope is string => typeof scope === 'string')
      : [],
    redirectUris: Array.isArray(oauth?.redirectUris)
      ? oauth.redirectUris.filter((value): value is string => typeof value === 'string')
      : [],
    clientKeyCount: Array.isArray(oauth?.clientKeys)
      ? oauth.clientKeys.filter(value => isRecord(value) && value.deleted !== true).length
      : 0,
    userTypes: Array.isArray(listing?.userTypes)
      ? listing.userTypes.filter((value): value is string => typeof value === 'string')
      : [],
    whiteLabel: listing?.isWhiteLabelFriendly !== false
  }
}

function triggerFilenameError(filename: string): Error {
  return new Error(
    `Workflow trigger filename "${filename}" must use lowercase letters, numbers, and hyphens, ` +
      'start with a letter, end with a letter or number, and use the .json extension.'
  )
}

export function workflowTriggerKeyFromFilename(filename: string): string {
  if (!TRIGGER_FILENAME_PATTERN.test(filename)) throw triggerFilenameError(filename)
  const key = filename.slice(0, -'.json'.length).replaceAll('-', '_')
  if (key.length > WORKFLOW_ACTION_KEY_MAX_LENGTH) {
    throw new Error(`Workflow trigger filenames may represent keys of at most ${WORKFLOW_ACTION_KEY_MAX_LENGTH} characters.`)
  }
  const portabilityError = workflowActionKeyValidationErrors(key).find(error => error.includes('operating system'))
  if (portabilityError) throw new Error(`Workflow trigger filename "${filename}" is reserved by the operating system.`)
  return key
}

export function workflowTriggerFilenameFromKey(key: string): string {
  const errors = workflowActionKeyValidationErrors(key)
  if (errors.length > 0) throw new Error(`Workflow trigger key "${key}" ${errors.join(' and ')}.`)
  return `${key.replaceAll('_', '-')}.json`
}

function validateState(value: unknown, whiteLabel: boolean): string[] {
  const pathLabel = '.ghl/workflow-triggers-state.json'
  if (!isRecord(value)) return [`${pathLabel} must be an object.`]
  const errors: string[] = []
  for (const key of Object.keys(value)) {
    if (!['schemaVersion', 'appId', 'baseline'].includes(key)) errors.push(`${pathLabel}.${key} is not supported.`)
  }
  if (value.schemaVersion !== 1) errors.push(`${pathLabel}.schemaVersion must be 1.`)
  if (typeof value.appId !== 'string' || !value.appId) errors.push(`${pathLabel}.appId must be a non-empty string.`)
  errors.push(
    ...validateWorkflowTriggersManifest(value.baseline, { whiteLabel }).map(error =>
      error.replace('workflow-triggers.json', `${pathLabel}.baseline`)
    )
  )
  return errors
}

function assertValidManifest(manifest: WorkflowTriggersManifest, binding: WorkflowTriggersAppBinding): void {
  const errors = validateWorkflowTriggersManifest(manifest, { whiteLabel: binding.whiteLabel })
  if (manifest.appId !== binding.appId) {
    errors.push(`Workflow trigger configuration belongs to app "${manifest.appId}", not "${binding.appId}".`)
  }
  if (errors.length > 0) throw new Error(`Workflow trigger configuration is invalid:\n- ${errors.join('\n- ')}`)
}

async function triggerJsonEntries(triggerDirectory: string): Promise<string[]> {
  const directoryStat = await stat(triggerDirectory)
  if (!directoryStat) return []
  if (directoryStat.isSymbolicLink()) throw new Error(`Workflow trigger directory "${triggerDirectory}" cannot be a symbolic link.`)
  if (!directoryStat.isDirectory()) throw new Error(`Workflow trigger path "${triggerDirectory}" is not a directory.`)
  const entries = await fs.readdir(triggerDirectory, { withFileTypes: true })
  return entries
    .filter(entry => entry.name.toLowerCase().endsWith('.json'))
    .map(entry => {
      const filePath = path.join(triggerDirectory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Workflow trigger file "${filePath}" cannot be a symbolic link.`)
      if (!entry.isFile()) throw new Error(`Workflow trigger file "${filePath}" is not a regular file.`)
      return entry.name
    })
    .sort()
}

function validateTriggerFile(value: unknown, relativeFile: string, filenameKey?: string): string[] {
  if (!isRecord(value)) return [`${relativeFile} must contain a JSON object.`]
  const errors: string[] = []
  for (const key of Object.keys(value)) {
    if (!TRIGGER_FILE_KEYS.has(key)) errors.push(`${relativeFile}.${key} is not supported.`)
  }
  if (value.schemaVersion !== 1) errors.push(`${relativeFile}.schemaVersion must be 1.`)
  if (typeof value.key !== 'string' || !value.key.trim()) {
    errors.push(`${relativeFile}.key must be a non-empty string.`)
  } else if (filenameKey && value.key !== filenameKey) {
    errors.push(`${relativeFile}.key "${value.key}" must match the filename-derived key "${filenameKey}".`)
  }
  if ('templateId' in value && (typeof value.templateId !== 'string' || !value.templateId.trim())) {
    errors.push(`${relativeFile}.templateId must be a non-empty string when provided.`)
  }
  if (!Array.isArray(value.versions)) errors.push(`${relativeFile}.versions must be an array.`)
  return errors
}

function mapManifestErrorToSourceFile(error: string, triggerFiles: Array<{ relativeFile: string }>): string {
  const match = /^workflow-triggers\.json\.triggers\[(\d+)\](.*)$/.exec(error)
  if (!match) return error.replace('workflow-triggers.json', 'workflow trigger configuration')
  const source = triggerFiles[Number(match[1])]
  return source ? `${source.relativeFile}${match[2]}` : error
}

async function readTriggerManifest(binding: WorkflowTriggersAppBinding): Promise<{
  manifest: WorkflowTriggersManifest
  triggerFiles: string[]
}> {
  const triggerDirectory = path.join(binding.directory, WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH)
  const filenames = await triggerJsonEntries(triggerDirectory)
  const errors: string[] = []
  const triggers: Array<{ relativeFile: string; value: WorkflowTriggerFile }> = []
  for (const filename of filenames) {
    const relativeFile = path.join(WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH, filename)
    const filePath = path.join(triggerDirectory, filename)
    let key: string | undefined
    try {
      key = workflowTriggerKeyFromFilename(filename)
    } catch (error) {
      errors.push((error as Error).message)
    }
    await requireRegularFile(filePath, 'Workflow trigger file')
    const value = await readJsonFile<unknown>(filePath)
    errors.push(...validateTriggerFile(value, relativeFile, key))
    if (key && isRecord(value) && Array.isArray(value.versions)) {
      triggers.push({
        relativeFile,
        value: {
          schemaVersion: 1,
          key: value.key as string,
          ...(typeof value.templateId === 'string' ? { templateId: value.templateId } : {}),
          versions: structuredClone(value.versions) as WorkflowTriggerDefinition['versions']
        }
      })
    }
  }
  const manifest: WorkflowTriggersManifest = {
    schemaVersion: 1,
    appId: binding.appId,
    triggers: triggers.map(item => ({
      key: item.value.key,
      ...(item.value.templateId ? { templateId: item.value.templateId } : {}),
      versions: item.value.versions
    }))
  }
  errors.push(
    ...validateWorkflowTriggersManifest(manifest, { whiteLabel: binding.whiteLabel }).map(error =>
      mapManifestErrorToSourceFile(error, triggers)
    )
  )
  if (errors.length > 0) throw new Error(`Workflow trigger configuration is invalid:\n- ${errors.join('\n- ')}`)
  return {
    manifest,
    triggerFiles: filenames.map(filename => path.join(triggerDirectory, filename))
  }
}

function triggerDirectoryFor(binding: WorkflowTriggersAppBinding): string {
  const triggerDirectory = path.join(binding.directory, WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH)
  return triggerDirectory
}

async function writeTriggerSources(
  binding: WorkflowTriggersAppBinding,
  manifest: WorkflowTriggersManifest
): Promise<WorkflowTriggersWorkspaceResult> {
  assertValidManifest(manifest, binding)
  await assertWorkspaceDocumentationFilesWritable(binding.directory)
  const triggerDirectory = triggerDirectoryFor(binding)
  if (manifest.triggers.length > 0) {
    await fs.mkdir(triggerDirectory, { recursive: true, mode: 0o755 })
    await fs.chmod(triggerDirectory, 0o755)
  }
  const guideFile = path.join(triggerDirectory, WORKFLOW_TRIGGERS_GUIDE_FILENAME)
  const stateFile = path.join(binding.directory, WORKFLOW_TRIGGERS_STATE_RELATIVE_PATH)
  const expectedFiles = new Set<string>()
  for (const trigger of manifest.triggers) {
    const filename = workflowTriggerFilenameFromKey(trigger.key)
    expectedFiles.add(filename)
    const filePath = path.join(triggerDirectory, filename)
    const payload: WorkflowTriggerFile = {
      schemaVersion: 1,
      key: trigger.key,
      ...(trigger.templateId ? { templateId: trigger.templateId } : {}),
      versions: structuredClone(trigger.versions)
    }
    await writeJsonFileAtomic(filePath, payload, 0o644)
  }
  const existing = await triggerJsonEntries(triggerDirectory)
  await Promise.all(
    existing
      .filter(filename => !expectedFiles.has(filename))
      .map(filename => fs.rm(path.join(triggerDirectory, filename), { force: true }))
  )
  if (manifest.triggers.length > 0) {
    await writeTextFileAtomic(guideFile, buildWorkflowTriggersGuide())
  } else {
    await removeRegularFileIfPresent(guideFile, 'Workflow trigger guide')
  }
  await removeEmptyDirectoryTree(triggerDirectory, binding.directory)
  await writeWorkspaceDocumentation(binding.directory)
  const legacyFile = path.join(binding.directory, LEGACY_WORKFLOW_TRIGGERS_RELATIVE_PATH)
  if (await requireRegularFile(legacyFile, 'Legacy workflow trigger file', true)) await fs.unlink(legacyFile)
  return {
    triggerDirectory,
    triggerFiles: [...expectedFiles].sort().map(filename => path.join(triggerDirectory, filename)),
    triggerGuideFile: guideFile,
    triggerStateFile: stateFile
  }
}

export async function loadWorkflowTriggersWorkspace(directory: string): Promise<WorkflowTriggersWorkspace> {
  const binding = await appBindingForWorkspace(directory)
  await assertWorkspacePathsSafe(binding)
  const legacyFile = path.join(binding.directory, LEGACY_WORKFLOW_TRIGGERS_RELATIVE_PATH)
  if (await requireRegularFile(legacyFile, 'Legacy workflow trigger file', true)) {
    throw new Error(`Legacy workflow trigger file "${legacyFile}" is not supported. Run \`ghl app triggers pull\` to migrate it.`)
  }
  const triggerDirectory = path.join(binding.directory, WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH)
  const stateFile = path.join(binding.directory, WORKFLOW_TRIGGERS_STATE_RELATIVE_PATH)
  await requireRegularFile(stateFile, 'Workflow trigger state')
  const [manifestResult, stateValue] = await Promise.all([
    readTriggerManifest(binding),
    readJsonFile<unknown>(stateFile)
  ])
  const stateErrors = validateState(stateValue, binding.whiteLabel)
  if (stateErrors.length > 0) {
    throw new Error(`Workflow trigger state is invalid:\n- ${stateErrors.join('\n- ')}`)
  }
  const state = stateValue as WorkflowTriggersState
  if (state.appId !== binding.appId || state.baseline.appId !== binding.appId) {
    throw new Error('Workflow trigger state does not match this app. Run `ghl app triggers pull` before making more changes.')
  }
  return {
    directory: binding.directory,
    allowedScopes: binding.allowedScopes,
    redirectUris: binding.redirectUris,
    clientKeyCount: binding.clientKeyCount,
    userTypes: binding.userTypes,
    triggerDirectory,
    triggerFiles: manifestResult.triggerFiles,
    guideFile: path.join(triggerDirectory, WORKFLOW_TRIGGERS_GUIDE_FILENAME),
    stateFile: path.join(binding.directory, WORKFLOW_TRIGGERS_STATE_RELATIVE_PATH),
    manifest: manifestResult.manifest,
    state
  }
}

export async function writeWorkflowTriggersWorkspace(
  directory: string,
  manifest: WorkflowTriggersManifest,
  baseline = manifest
): Promise<WorkflowTriggersWorkspaceResult> {
  const binding = await appBindingForWorkspace(directory)
  assertValidManifest(baseline, binding)
  const result = await writeTriggerSources(binding, manifest)
  await writeJsonFileAtomic(result.triggerStateFile, {
    schemaVersion: 1,
    appId: manifest.appId,
    baseline
  } satisfies WorkflowTriggersState, 0o600)
  return result
}

export async function assertWorkflowTriggersWorkspaceWritable(
  directory: string,
  manifest?: WorkflowTriggersManifest
): Promise<void> {
  const binding = await appBindingForWorkspace(directory)
  await Promise.all([
    assertWorkspacePathsSafe(binding),
    assertWorkspaceDocumentationFilesWritable(binding.directory)
  ])
  const filenames = await triggerJsonEntries(path.join(binding.directory, WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH))
  for (const filename of filenames) workflowTriggerKeyFromFilename(filename)
  if (manifest) assertValidManifest(manifest, binding)
}

export async function loadWorkflowTriggersWorkspaceIfPresent(
  directory: string
): Promise<WorkflowTriggersWorkspace | undefined> {
  const workspace = await readPullWorkspaceBinding(directory)
  if (!workspace) return undefined
  const [directoryStat, stateStat, legacyStat] = await Promise.all([
    stat(path.join(workspace.directory, WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH)),
    stat(path.join(workspace.directory, WORKFLOW_TRIGGERS_STATE_RELATIVE_PATH)),
    stat(path.join(workspace.directory, LEGACY_WORKFLOW_TRIGGERS_RELATIVE_PATH))
  ])
  if (!directoryStat && !stateStat && !legacyStat) return undefined
  if (directoryStat && !stateStat && !legacyStat && directoryStat.isDirectory()) {
    const entries = await fs.readdir(path.join(workspace.directory, WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH))
    if (!entries.some(entry => entry.toLowerCase().endsWith('.json'))) return undefined
  }
  return loadWorkflowTriggersWorkspace(workspace.directory)
}
