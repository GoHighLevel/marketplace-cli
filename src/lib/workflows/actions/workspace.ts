import { promises as fs } from 'node:fs'
import path from 'node:path'

import { isRecord } from '../../api/response.js'
import { writeTextFileAtomic } from '../../shared/atomic-file.js'
import { errorMessage } from '../../shared/errors.js'
import { assertWorkspaceDocumentationFilesWritable, writeWorkspaceDocumentation } from '../../app/instructions.js'
import { requireRegularFile } from '../../app/local-workspace.js'
import { readPullWorkspaceBinding } from '../../app/pull.js'
import { APP_MANIFEST_FILENAME } from '../../app/workspace.js'
import { readJsonFile, writeJsonFileAtomic } from '../../shared/json-file.js'
import {
  workflowActionCodeFilename,
  workflowActionCodeReference,
  workflowActionCodeSyntaxError,
  workflowActionSourceLanguage,
  type WorkflowActionSourceLanguage,
  WORKFLOW_ACTION_CODE_DIRECTORY_NAME,
  WORKFLOW_ACTION_CODE_MAX_BYTES
} from './code.js'
import { buildWorkflowActionsGuide, WORKFLOW_ACTIONS_GUIDE_FILENAME } from './guide.js'
import { workflowActionKeyValidationErrors, WORKFLOW_ACTION_KEY_MAX_LENGTH } from './key.js'
import { type WorkflowActionDefinition, type WorkflowActionsManifest, type WorkflowActionVersion } from './manifest.js'
import { validateWorkflowActionsManifest } from './schema.js'
import { removeEmptyDirectoryTree, removeRegularFileIfPresent } from '../../shared/workspace-files.js'
import { isWorkflowVersion } from '../shared/value-validation.js'
import { validateJsonSchema, withJsonSchemaReference, writeJsonSchemaWorkspace } from '../../app/json-schema.js'
import {
  compileWorkflowActionTypeScript,
  generateWorkflowActionJavaScriptScaffold,
  isWorkflowActionJavaScriptScaffold,
  prepareWorkflowActionJavaScript
} from './typescript.js'
import {
  assertWorkflowActionTypesWorkspaceWritable,
  removeWorkflowActionTypesWorkspace,
  workflowActionVersionTypePrefix,
  writeWorkflowActionTypesWorkspace
} from './types.js'

export { WORKFLOW_ACTIONS_GUIDE_FILENAME }
export { WORKFLOW_ACTION_CODE_MAX_BYTES }
export const WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH = path.join('src', 'modules', 'workflows', 'actions')
export const WORKFLOW_ACTION_CODE_DIRECTORY_RELATIVE_PATH = path.join(
  WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH,
  WORKFLOW_ACTION_CODE_DIRECTORY_NAME
)
export const WORKFLOW_ACTIONS_STATE_RELATIVE_PATH = path.join('.ghl', 'workflow-actions-state.json')
export const LEGACY_WORKFLOW_ACTIONS_RELATIVE_PATH = path.join('src', 'modules', 'workflows', 'workflow-actions.json')

const ACTION_FILENAME_PATTERN = /^[a-z](?:[a-z0-9-]*[a-z0-9])?\.json$/
interface WorkflowActionFile {
  $schema?: string
  schemaVersion: 1
  key: string
  templateId?: string
  versions: WorkflowActionDefinition['versions']
}

export interface WorkflowActionsState {
  schemaVersion: 1
  appId: string
  baseline: WorkflowActionsManifest
}

export interface WorkflowActionsWorkspace {
  directory: string
  allowedScopes: string[]
  actionDirectory: string
  actionFiles: string[]
  codeDirectory: string
  codeFiles: string[]
  codeSources: WorkflowActionCodeSource[]
  guideFile: string
  stateFile: string
  manifest: WorkflowActionsManifest
  state: WorkflowActionsState
}

export interface WorkflowActionsWorkspaceResult {
  actionDirectory: string
  actionFiles: string[]
  codeDirectory: string
  codeFiles: string[]
  guideFile: string
  stateFile: string
}

interface WorkflowActionsAppBinding {
  directory: string
  appId: string
  allowedScopes: string[]
  whiteLabel: boolean
}

interface WorkflowActionSourceResult {
  actionDirectory: string
  actionFiles: string[]
  codeDirectory: string
  codeFiles: string[]
  guideFile: string
}

export interface WorkflowActionCodeSource {
  actionKey: string
  version: string
  language: WorkflowActionSourceLanguage
  file: string
  source: string
  compiledCode: string
}

export type WorkflowActionCodeSourceOverride = Omit<WorkflowActionCodeSource, 'file'>

export interface WriteWorkflowActionsWorkspaceOptions {
  codeSourceOverrides?: readonly WorkflowActionCodeSourceOverride[]
  includeJsonSchema?: boolean
  preserveCodeSources?: readonly WorkflowActionCodeSource[]
}

async function stat(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function assertSafeWorkspaceRoot(directory: string): Promise<void> {
  const directoryStat = await stat(directory)
  if (!directoryStat) throw new Error(`App workspace "${directory}" does not exist.`)
  if (directoryStat.isSymbolicLink()) throw new Error(`App workspace "${directory}" cannot be a symbolic link.`)
  if (!directoryStat.isDirectory()) throw new Error(`App workspace "${directory}" is not a directory.`)
}

async function assertSafeDirectoryPath(directory: string, relativePath: string): Promise<void> {
  let current = directory
  for (const part of relativePath.split(path.sep)) {
    current = path.join(current, part)
    const currentStat = await stat(current)
    if (!currentStat) continue
    if (currentStat.isSymbolicLink()) throw new Error(`Workflow action path "${current}" cannot be a symbolic link.`)
    if (!currentStat.isDirectory()) throw new Error(`Workflow action path "${current}" is not a directory.`)
  }
}

async function appBindingForWorkspace(inputDirectory: string): Promise<WorkflowActionsAppBinding> {
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
    whiteLabel: listing?.isWhiteLabelFriendly !== false
  }
}

function actionFilenameError(filename: string): Error {
  return new Error(
    `Workflow action filename "${filename}" must use lowercase letters, numbers, and hyphens, ` +
      'start with a letter, end with a letter or number, and use the .json extension.'
  )
}

export function workflowActionKeyFromFilename(filename: string): string {
  if (!ACTION_FILENAME_PATTERN.test(filename)) throw actionFilenameError(filename)
  const key = filename.slice(0, -'.json'.length).replaceAll('-', '_')
  if (key.length > WORKFLOW_ACTION_KEY_MAX_LENGTH) {
    throw new Error(
      `Workflow action filenames may represent keys of at most ${WORKFLOW_ACTION_KEY_MAX_LENGTH} characters.`
    )
  }
  const portabilityError = workflowActionKeyValidationErrors(key).find(error => error.includes('operating system'))
  if (portabilityError) throw new Error(`Workflow action filename "${filename}" is reserved by the operating system.`)
  return key
}

export function workflowActionFilenameFromKey(key: string): string {
  const errors = workflowActionKeyValidationErrors(key)
  if (errors.length > 0) throw new Error(`Workflow action key "${key}" ${errors.join(' and ')}.`)
  return `${key.replaceAll('_', '-')}.json`
}

function validateState(value: unknown, whiteLabel: boolean): string[] {
  const pathLabel = '.ghl/workflow-actions-state.json'
  if (!isRecord(value)) return [`${pathLabel} must be an object.`]
  const errors: string[] = []
  for (const key of Object.keys(value)) {
    if (!['schemaVersion', 'appId', 'baseline'].includes(key)) errors.push(`${pathLabel}.${key} is not supported.`)
  }
  if (value.schemaVersion !== 1) errors.push(`${pathLabel}.schemaVersion must be 1.`)
  if (typeof value.appId !== 'string' || !value.appId) errors.push(`${pathLabel}.appId must be a non-empty string.`)
  errors.push(
    ...validateWorkflowActionsManifest(value.baseline, { whiteLabel }).map(error =>
      error.replace('workflow-actions.json', `${pathLabel}.baseline`)
    )
  )
  return errors
}

function assertValidManifest(manifest: WorkflowActionsManifest, binding: WorkflowActionsAppBinding): void {
  const errors = validateWorkflowActionsManifest(manifest, { whiteLabel: binding.whiteLabel })
  if (manifest.appId !== binding.appId) {
    errors.push(`Workflow action configuration belongs to app "${manifest.appId}", not "${binding.appId}".`)
  }
  if (errors.length > 0) throw new Error(`Workflow action configuration is invalid:\n- ${errors.join('\n- ')}`)
}

function actionSourceFromDefinition(
  action: WorkflowActionDefinition,
  includeJsonSchema: boolean,
  sourceByVersion: ReadonlyMap<string, WorkflowActionCodeSourceOverride>
): {
  file: WorkflowActionFile
  codeSources: Array<WorkflowActionCodeSourceOverride & { filename: string }>
} {
  const versions = structuredClone(action.versions)
  const codeSources: Array<WorkflowActionCodeSourceOverride & { filename: string }> = []
  for (const version of versions) {
    if (version.executionConfig?.type !== 'CODE') continue
    const compiledCode = version.executionConfig.code ?? ''
    const selected = sourceByVersion.get(`${action.key}@${version.version}`)
    const language = selected?.language ?? 'javascript'
    const source = selected?.source ?? compiledCode
    const filename = workflowActionCodeFilename(action.key, version.version, language)
    codeSources.push({ actionKey: action.key, version: version.version, language, filename, source, compiledCode })
    const sourceExecution = version.executionConfig as unknown as Record<string, unknown>
    delete sourceExecution.code
    sourceExecution.codeFile = workflowActionCodeReference(action.key, version.version, language)
  }
  const file: WorkflowActionFile = {
    schemaVersion: 1,
    key: action.key,
    ...(action.templateId ? { templateId: action.templateId } : {}),
    versions
  }
  return {
    file: includeJsonSchema ? withJsonSchemaReference(file, 'workflow-action') : file,
    codeSources
  }
}

function replaceHandlerVersion(source: WorkflowActionCodeSource, actionKey: string, targetVersion: string): string {
  const previous = workflowActionVersionTypePrefix(actionKey, source.version)
  const next = workflowActionVersionTypePrefix(actionKey, targetVersion)
  return source.source.replaceAll(previous, next)
}

/* The checked JavaScript wrapper is a lossless local envelope around the
   uploaded body, so a portal edit is wrapped again instead of downgrading the
   file to plain JavaScript and dropping its editor types. TypeScript cannot be
   rebuilt from JavaScript, so its portal edits surface as pull conflicts. */
function rewrappedJavaScriptSource(
  binding: WorkflowActionsAppBinding,
  action: WorkflowActionDefinition,
  version: WorkflowActionVersion,
  previous: WorkflowActionCodeSourceOverride
): WorkflowActionCodeSourceOverride | undefined {
  const code = version.executionConfig?.code
  if (previous.language !== 'javascript' || !isWorkflowActionJavaScriptScaffold(previous.source)) return undefined
  if (code === undefined) return undefined
  const source = generateWorkflowActionJavaScriptScaffold(action, version, code)
  const filename = path.join(
    binding.directory,
    WORKFLOW_ACTION_CODE_DIRECTORY_RELATIVE_PATH,
    workflowActionCodeFilename(action.key, version.version, 'javascript')
  )
  const prepared = prepareWorkflowActionJavaScript({ directory: binding.directory, filename, source, action, version })
  if (prepared.errors.length > 0 || prepared.code !== code) return undefined
  return { actionKey: action.key, version: version.version, language: 'javascript', source, compiledCode: code }
}

function resolveCodeSources(
  binding: WorkflowActionsAppBinding,
  manifest: WorkflowActionsManifest,
  options: WriteWorkflowActionsWorkspaceOptions
): Map<string, WorkflowActionCodeSourceOverride> {
  const preserved = options.preserveCodeSources ?? []
  const sourceByVersion = new Map<string, WorkflowActionCodeSourceOverride>()
  for (const source of preserved) sourceByVersion.set(`${source.actionKey}@${source.version}`, source)
  for (const source of options.codeSourceOverrides ?? []) {
    sourceByVersion.set(`${source.actionKey}@${source.version}`, source)
  }

  for (const action of manifest.actions) {
    for (const version of action.versions) {
      if (version.executionConfig?.type !== 'CODE') continue
      const id = `${action.key}@${version.version}`
      if (!sourceByVersion.has(id)) {
        const compatible = preserved.find(
          source =>
            source.actionKey === action.key &&
            (source.language === 'typescript' || isWorkflowActionJavaScriptScaffold(source.source)) &&
            source.compiledCode === version.executionConfig?.code
        )
        if (compatible) {
          sourceByVersion.set(id, {
            actionKey: action.key,
            version: version.version,
            language: compatible.language,
            source: replaceHandlerVersion(compatible, action.key, version.version),
            compiledCode: compatible.compiledCode
          })
        }
      }
      const selected = sourceByVersion.get(id)
      if (!selected || selected.compiledCode !== version.executionConfig.code) {
        const rewrapped = selected ? rewrappedJavaScriptSource(binding, action, version, selected) : undefined
        if (rewrapped) sourceByVersion.set(id, rewrapped)
        else sourceByVersion.delete(id)
        continue
      }
      if (selected.language !== 'typescript' && !isWorkflowActionJavaScriptScaffold(selected.source)) continue
      const filename = path.join(
        binding.directory,
        WORKFLOW_ACTION_CODE_DIRECTORY_RELATIVE_PATH,
        workflowActionCodeFilename(action.key, version.version, selected.language)
      )
      const input = { directory: binding.directory, filename, source: selected.source, action, version }
      const compiled =
        selected.language === 'typescript'
          ? compileWorkflowActionTypeScript(input)
          : prepareWorkflowActionJavaScript(input)
      if (compiled.errors.length > 0) {
        throw new Error(
          `${selected.language === 'typescript' ? 'TypeScript' : 'JavaScript'} source for action "${action.key}" version ${version.version} conflicts with its definition:\n- ` +
            compiled.errors.join('\n- ')
        )
      }
      if (compiled.code !== version.executionConfig.code) sourceByVersion.delete(id)
    }
  }
  return sourceByVersion
}

function validateActionFile(value: unknown, relativeFile: string, filenameKey?: string): string[] {
  if (!isRecord(value)) return [`${relativeFile} must contain a JSON object.`]
  const errors = validateJsonSchema('workflow-action', value, relativeFile)
  if (typeof value.key !== 'string' || !value.key.trim()) {
    const keyPath = `${relativeFile}.key`
    errors.splice(
      0,
      errors.length,
      ...errors.filter(error => !error.startsWith(keyPath)),
      `${keyPath} must be a non-empty string.`
    )
  } else if (filenameKey && value.key !== filenameKey) {
    errors.push(`${relativeFile}.key "${value.key}" must match the filename-derived key "${filenameKey}".`)
  }
  return [...new Set(errors)]
}

function mapManifestErrorToSourceFile(error: string, actionFiles: Array<{ relativeFile: string }>): string {
  const match = /^workflow-actions\.json\.actions\[(\d+)\](.*)$/.exec(error)
  if (!match) return error.replace('workflow-actions.json', 'workflow action configuration')
  const source = actionFiles[Number(match[1])]
  return source ? `${source.relativeFile}${match[2]}` : error
}

async function assertLegacySourceAbsent(directory: string): Promise<void> {
  const legacyFile = path.join(directory, LEGACY_WORKFLOW_ACTIONS_RELATIVE_PATH)
  if (!(await requireRegularFile(legacyFile, 'Legacy workflow action file', true))) return
  throw new Error(
    `A legacy workflow-actions.json file exists at "${legacyFile}". ` +
      'Back up any local edits and run `ghl app actions pull` to migrate it to one file per action.'
  )
}

async function actionJsonEntries(actionDirectory: string): Promise<string[]> {
  const directoryStat = await stat(actionDirectory)
  if (!directoryStat) return []
  if (directoryStat.isSymbolicLink()) {
    throw new Error(`Workflow action directory "${actionDirectory}" cannot be a symbolic link.`)
  }
  if (!directoryStat.isDirectory()) throw new Error(`Workflow action path "${actionDirectory}" is not a directory.`)

  const entries = await fs.readdir(actionDirectory, { withFileTypes: true })
  return entries
    .filter(entry => entry.name.toLowerCase().endsWith('.json'))
    .map(entry => {
      const filePath = path.join(actionDirectory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Workflow action file "${filePath}" cannot be a symbolic link.`)
      if (!entry.isFile()) throw new Error(`Workflow action file "${filePath}" is not a regular file.`)
      return entry.name
    })
    .sort()
}

async function managedCodeEntries(codeDirectory: string): Promise<string[]> {
  const directoryStat = await stat(codeDirectory)
  if (!directoryStat) return []
  if (directoryStat.isSymbolicLink()) {
    throw new Error(`Workflow action code directory "${codeDirectory}" cannot be a symbolic link.`)
  }
  if (!directoryStat.isDirectory()) throw new Error(`Workflow action code path "${codeDirectory}" is not a directory.`)

  const entries = await fs.readdir(codeDirectory, { withFileTypes: true })
  return entries
    .filter(entry => /\.(?:js|ts)$/i.test(entry.name))
    .map(entry => {
      const filePath = path.join(codeDirectory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Workflow action code file "${filePath}" cannot be a symbolic link.`)
      if (!entry.isFile()) throw new Error(`Workflow action code file "${filePath}" is not a regular file.`)
      return entry.name
    })
    .sort()
}

async function readCodeFile(filePath: string): Promise<{ code?: string; error?: string }> {
  const fileStat = await stat(filePath)
  if (!fileStat) return { error: `${filePath} does not exist.` }
  if (fileStat.isSymbolicLink()) return { error: `${filePath} cannot be a symbolic link.` }
  if (!fileStat.isFile()) return { error: `${filePath} is not a regular file.` }
  if (fileStat.size > WORKFLOW_ACTION_CODE_MAX_BYTES) {
    return { error: `${filePath} must be at most 1 MiB.` }
  }
  try {
    const bytes = await fs.readFile(filePath)
    if (bytes.byteLength > WORKFLOW_ACTION_CODE_MAX_BYTES) {
      return { error: `${filePath} must be at most 1 MiB.` }
    }
    return { code: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch (error) {
    if (error instanceof TypeError) return { error: `${filePath} must contain valid UTF-8 text.` }
    return { error: `${filePath} could not be read: ${(error as Error).message}` }
  }
}

async function hydrateCodeSources(
  actionDirectory: string,
  sources: Array<{ relativeFile: string; key: string; value: unknown }>
): Promise<{
  actions: WorkflowActionDefinition[]
  codeFiles: string[]
  codeSources: WorkflowActionCodeSource[]
  errors: string[]
}> {
  const codeDirectory = path.join(actionDirectory, WORKFLOW_ACTION_CODE_DIRECTORY_NAME)
  const errors: string[] = []
  const referenced = new Set<string>()
  const actions: WorkflowActionDefinition[] = []
  const pending: Array<{
    action: WorkflowActionDefinition
    config: Record<string, unknown>
    filePath: string
    language: WorkflowActionSourceLanguage
    propertyPath: string
    validateSyntax: boolean
    version: WorkflowActionVersion
  }> = []

  for (const source of sources) {
    const file = isRecord(source.value) ? source.value : {}
    const versions = Array.isArray(file.versions) ? structuredClone(file.versions) : []
    const action: WorkflowActionDefinition = {
      key: typeof file.key === 'string' ? file.key : source.key,
      ...(typeof file.templateId === 'string' ? { templateId: file.templateId } : {}),
      versions: versions as WorkflowActionDefinition['versions']
    }
    actions.push(action)
    versions.forEach((version, versionIndex) => {
      if (!isRecord(version) || !isRecord(version.executionConfig)) return
      const config = version.executionConfig
      const propertyPath = `${source.relativeFile}.versions[${versionIndex}].executionConfig`
      if (config.type !== 'CODE') {
        if (config.codeFile !== undefined)
          errors.push(`${propertyPath}.codeFile is only supported when type is "CODE".`)
        return
      }
      if (config.code !== undefined) {
        errors.push(`${propertyPath}.code cannot contain inline code; use the version's codeFile instead.`)
      }
      if (typeof version.version !== 'string' || !isWorkflowVersion(version.version)) return
      const language = typeof config.codeFile === 'string' ? workflowActionSourceLanguage(config.codeFile) : undefined
      if (!language) {
        errors.push(`${propertyPath}.codeFile must use a canonical .js or .ts action source path.`)
        return
      }
      const expectedReference = workflowActionCodeReference(source.key, version.version, language)
      if (config.codeFile !== expectedReference) {
        errors.push(`${propertyPath}.codeFile must be "${expectedReference}".`)
        return
      }
      const filename = workflowActionCodeFilename(source.key, version.version, language)
      if (referenced.has(filename)) {
        errors.push(`${propertyPath}.codeFile duplicates "${expectedReference}".`)
        return
      }
      referenced.add(filename)
      pending.push({
        action,
        config,
        filePath: path.join(codeDirectory, filename),
        language,
        propertyPath,
        validateSyntax: version.status !== 'published' && version.status !== 'in_review',
        version: version as unknown as WorkflowActionVersion
      })
    })
  }

  const resolved = await Promise.all(pending.map(item => readCodeFile(item.filePath)))
  const hydratedSources: WorkflowActionCodeSource[] = []
  resolved.forEach((result, index) => {
    const item = pending[index]
    if (result.error) {
      errors.push(`${item.propertyPath}.codeFile ${result.error}`)
      return
    }
    const source = result.code ?? ''
    const compileInput = {
      directory: path.resolve(actionDirectory, '..', '..', '..', '..'),
      filename: item.filePath,
      source,
      action: item.action,
      version: item.version
    }
    const compiled =
      item.language === 'typescript'
        ? compileWorkflowActionTypeScript(compileInput)
        : isWorkflowActionJavaScriptScaffold(source)
          ? prepareWorkflowActionJavaScript(compileInput)
          : { code: source, errors: [] }
    if (compiled.errors.length > 0) {
      errors.push(...compiled.errors.map(error => `${item.propertyPath}.codeFile ${error}`))
      return
    }
    const syntaxError = item.validateSyntax
      ? workflowActionCodeSyntaxError(compiled.code, item.filePath.replace(/\.ts$/, '.js'))
      : undefined
    if (syntaxError) {
      errors.push(`${item.propertyPath}.codeFile ${syntaxError}`)
      return
    }
    delete item.config.codeFile
    item.config.code = compiled.code
    hydratedSources.push({
      actionKey: item.action.key,
      version: item.version.version,
      language: item.language,
      file: item.filePath,
      source,
      compiledCode: compiled.code
    })
  })

  const existing = await managedCodeEntries(codeDirectory)
  for (const filename of existing) {
    if (!referenced.has(filename)) {
      errors.push(
        `${path.join(WORKFLOW_ACTION_CODE_DIRECTORY_RELATIVE_PATH, filename)} is not referenced by an action version.`
      )
    }
  }
  return {
    actions,
    codeFiles: [...referenced].sort().map(filename => path.join(codeDirectory, filename)),
    codeSources: hydratedSources.sort((left, right) => left.file.localeCompare(right.file)),
    errors
  }
}

async function readActionManifest(binding: WorkflowActionsAppBinding): Promise<{
  manifest: WorkflowActionsManifest
  actionFiles: string[]
  codeFiles: string[]
  codeSources: WorkflowActionCodeSource[]
}> {
  const actionDirectory = path.join(binding.directory, WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH)
  const filenames = await actionJsonEntries(actionDirectory)
  const errors: string[] = []
  const sources: Array<{ relativeFile: string; key: string; value: unknown }> = []

  for (const filename of filenames) {
    const relativeFile = path.join(WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH, filename)
    let key: string | undefined
    try {
      key = workflowActionKeyFromFilename(filename)
    } catch (error) {
      errors.push((error as Error).message)
    }
    const filePath = path.join(actionDirectory, filename)
    let value: unknown
    try {
      value = await readJsonFile<unknown>(filePath)
    } catch (error) {
      errors.push((error as Error).message)
      continue
    }
    errors.push(...validateActionFile(value, relativeFile, key))
    if (key) sources.push({ relativeFile, key, value })
  }

  const codeSources = await hydrateCodeSources(actionDirectory, sources)
  if (codeSources.errors.length > 0) {
    /* File-level problems are reported alongside code problems because a
       malformed definition is often why its source could not be compiled. */
    throw new Error(`Workflow action code is invalid:\n- ${[...codeSources.errors, ...errors].join('\n- ')}`)
  }
  const actions = codeSources.actions
  const manifest: WorkflowActionsManifest = { schemaVersion: 1, appId: binding.appId, actions }
  errors.push(
    ...validateWorkflowActionsManifest(manifest, { whiteLabel: binding.whiteLabel }).map(error =>
      mapManifestErrorToSourceFile(error, sources)
    )
  )
  if (errors.length > 0) throw new Error(`Workflow action configuration is invalid:\n- ${errors.join('\n- ')}`)
  return {
    manifest,
    actionFiles: filenames.map(filename => path.join(actionDirectory, filename)),
    codeFiles: codeSources.codeFiles,
    codeSources: codeSources.codeSources
  }
}

async function assertWorkspacePathsSafe(binding: WorkflowActionsAppBinding): Promise<void> {
  await assertSafeWorkspaceRoot(binding.directory)
  await Promise.all([
    assertSafeDirectoryPath(binding.directory, WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH),
    assertSafeDirectoryPath(binding.directory, WORKFLOW_ACTION_CODE_DIRECTORY_RELATIVE_PATH),
    assertSafeDirectoryPath(binding.directory, path.dirname(WORKFLOW_ACTIONS_STATE_RELATIVE_PATH))
  ])
  await requireRegularFile(
    path.join(binding.directory, WORKFLOW_ACTIONS_STATE_RELATIVE_PATH),
    'Workflow action state',
    true
  )
}

async function sourceDirectories(binding: WorkflowActionsAppBinding): Promise<{
  actionDirectory: string
  codeDirectory: string
}> {
  const actionDirectory = path.join(binding.directory, WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH)
  const codeDirectory = path.join(binding.directory, WORKFLOW_ACTION_CODE_DIRECTORY_RELATIVE_PATH)
  return { actionDirectory, codeDirectory }
}

async function writeActionSources(
  binding: WorkflowActionsAppBinding,
  manifest: WorkflowActionsManifest,
  options: WriteWorkflowActionsWorkspaceOptions = {}
): Promise<WorkflowActionSourceResult> {
  assertValidManifest(manifest, binding)
  await Promise.all([assertWorkspacePathsSafe(binding), assertWorkspaceDocumentationFilesWritable(binding.directory)])
  const includeJsonSchema = options.includeJsonSchema !== false
  const legacyFile = path.join(binding.directory, LEGACY_WORKFLOW_ACTIONS_RELATIVE_PATH)
  const legacyExists = await requireRegularFile(legacyFile, 'Legacy workflow action file', true)
  const { actionDirectory, codeDirectory } = await sourceDirectories(binding)
  const existingFiles = await actionJsonEntries(actionDirectory)
  const existingCodeFiles = await managedCodeEntries(codeDirectory)
  const sourceByVersion = resolveCodeSources(binding, manifest, options)
  for (const filename of existingFiles) workflowActionKeyFromFilename(filename)
  const desired = [...manifest.actions]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(action => ({
      filename: workflowActionFilenameFromKey(action.key),
      source: actionSourceFromDefinition(action, includeJsonSchema, sourceByVersion)
    }))
  const filenames = new Set(desired.map(item => item.filename))
  if (filenames.size !== desired.length) throw new Error('Workflow action keys must map to unique filenames.')

  const actionFiles = desired.map(item => path.join(actionDirectory, item.filename))
  const codeSources = desired
    .flatMap(item => item.source.codeSources)
    .sort((left, right) => left.filename.localeCompare(right.filename))
  const codeFilenames = new Set(codeSources.map(item => item.filename))
  if (codeFilenames.size !== codeSources.length)
    throw new Error('Workflow action code files must map to unique action versions.')
  const codeFiles = codeSources.map(item => path.join(codeDirectory, item.filename))
  const appTypesEnabled = (await stat(path.join(binding.directory, 'ghl-app.d.ts')))?.isFile() === true
  const actionTypesEnabled =
    manifest.actions.length > 0 &&
    (appTypesEnabled ||
      codeSources.some(source => source.language === 'typescript' || isWorkflowActionJavaScriptScaffold(source.source)))
  if (actionTypesEnabled) await assertWorkflowActionTypesWorkspaceWritable(binding.directory, manifest)
  if (includeJsonSchema) await writeJsonSchemaWorkspace(binding.directory)
  if (desired.length > 0) {
    await fs.mkdir(actionDirectory, { recursive: true, mode: 0o755 })
    await fs.chmod(actionDirectory, 0o755)
  }
  if (codeSources.length > 0) {
    await fs.mkdir(codeDirectory, { recursive: true, mode: 0o755 })
    await fs.chmod(codeDirectory, 0o755)
  }
  await Promise.all(codeSources.map((item, index) => writeTextFileAtomic(codeFiles[index], item.source)))
  await Promise.all(desired.map((item, index) => writeJsonFileAtomic(actionFiles[index], item.source.file, 0o644)))
  await Promise.all(
    existingCodeFiles
      .filter(filename => !codeFilenames.has(filename))
      .map(filename => fs.unlink(path.join(codeDirectory, filename)))
  )
  await Promise.all(
    existingFiles
      .filter(filename => !filenames.has(filename))
      .map(filename => fs.unlink(path.join(actionDirectory, filename)))
  )
  const guideFile = path.join(actionDirectory, WORKFLOW_ACTIONS_GUIDE_FILENAME)
  if (desired.length > 0) {
    await writeTextFileAtomic(guideFile, buildWorkflowActionsGuide())
  } else {
    await removeRegularFileIfPresent(guideFile, 'Workflow action guide')
  }
  if (actionTypesEnabled) {
    await writeWorkflowActionTypesWorkspace(binding.directory, manifest)
  } else {
    await removeWorkflowActionTypesWorkspace(binding.directory)
  }
  await removeEmptyDirectoryTree(codeDirectory, binding.directory)
  await removeEmptyDirectoryTree(actionDirectory, binding.directory)
  await writeWorkspaceDocumentation(binding.directory)
  if (legacyExists) await fs.unlink(legacyFile)
  return { actionDirectory, actionFiles, codeDirectory, codeFiles, guideFile }
}

export async function assertWorkflowActionsWorkspaceWritable(
  directory: string,
  manifest?: WorkflowActionsManifest
): Promise<void> {
  const binding = await appBindingForWorkspace(directory)
  await Promise.all([assertWorkspacePathsSafe(binding), assertWorkspaceDocumentationFilesWritable(binding.directory)])
  const filenames = await actionJsonEntries(path.join(binding.directory, WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH))
  for (const filename of filenames) workflowActionKeyFromFilename(filename)
  if (manifest) assertValidManifest(manifest, binding)
}

export async function writeLocalWorkflowActionsManifest(
  directory: string,
  manifest: WorkflowActionsManifest,
  options: WriteWorkflowActionsWorkspaceOptions = {}
): Promise<WorkflowActionSourceResult> {
  const binding = await appBindingForWorkspace(directory)
  return writeActionSources(binding, manifest, options)
}

export async function writeWorkflowActionsWorkspace(
  directory: string,
  manifest: WorkflowActionsManifest,
  baseline: WorkflowActionsManifest = manifest,
  options: WriteWorkflowActionsWorkspaceOptions = {}
): Promise<WorkflowActionsWorkspaceResult> {
  const binding = await appBindingForWorkspace(directory)
  assertValidManifest(baseline, binding)
  const sources = await writeActionSources(binding, manifest, options)
  const stateFile = path.join(binding.directory, WORKFLOW_ACTIONS_STATE_RELATIVE_PATH)
  const state: WorkflowActionsState = {
    schemaVersion: 1,
    appId: manifest.appId,
    baseline
  }
  await writeJsonFileAtomic(stateFile, state, 0o600)
  return { ...sources, stateFile }
}

export async function loadWorkflowActionsWorkspace(directory: string): Promise<WorkflowActionsWorkspace> {
  const binding = await appBindingForWorkspace(directory)
  await assertWorkspacePathsSafe(binding)
  await assertLegacySourceAbsent(binding.directory)
  const actionDirectory = path.join(binding.directory, WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH)
  const codeDirectory = path.join(binding.directory, WORKFLOW_ACTION_CODE_DIRECTORY_RELATIVE_PATH)
  const stateFile = path.join(binding.directory, WORKFLOW_ACTIONS_STATE_RELATIVE_PATH)
  await requireRegularFile(stateFile, 'Workflow action state')
  const { manifest, actionFiles, codeFiles, codeSources } = await readActionManifest(binding)
  const state = await readJsonFile<unknown>(stateFile)
  const stateErrors = validateState(state, binding.whiteLabel)
  if (stateErrors.length > 0) {
    throw new Error(`Workflow action configuration is invalid:\n- ${stateErrors.join('\n- ')}`)
  }
  const typedState = state as WorkflowActionsState
  if (typedState.appId !== binding.appId || typedState.baseline.appId !== binding.appId) {
    throw new Error(
      'Workflow action state does not match this app. Run `ghl app actions pull` before making more changes.'
    )
  }
  return {
    directory: binding.directory,
    allowedScopes: binding.allowedScopes,
    actionDirectory,
    actionFiles,
    codeDirectory,
    codeFiles,
    codeSources,
    guideFile: path.join(actionDirectory, WORKFLOW_ACTIONS_GUIDE_FILENAME),
    stateFile,
    manifest,
    state: typedState
  }
}

export async function loadWorkflowActionsWorkspaceIfPresent(
  directory: string
): Promise<WorkflowActionsWorkspace | undefined> {
  const workspace = await readPullWorkspaceBinding(directory)
  if (!workspace) return undefined
  const actionDirectory = path.join(workspace.directory, WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH)
  const stateFile = path.join(workspace.directory, WORKFLOW_ACTIONS_STATE_RELATIVE_PATH)
  const legacyFile = path.join(workspace.directory, LEGACY_WORKFLOW_ACTIONS_RELATIVE_PATH)
  const [actionStat, stateStat, legacyStat] = await Promise.all([
    stat(actionDirectory),
    stat(stateFile),
    stat(legacyFile)
  ])
  if (!actionStat && !stateStat && !legacyStat) return undefined
  return loadWorkflowActionsWorkspace(workspace.directory)
}

/* Pull protects local edits only when the workspace carries a baseline for
   this app. A legacy aggregate file, a missing state file, or state left by
   another app has no usable baseline, so pull rebuilds the workspace as the
   recovery messages promise. Invalid action sources still reject here so that
   a pull never silently discards work it could not compare. */
export async function loadWorkflowActionsPullBaseline(
  directory: string
): Promise<WorkflowActionsWorkspace | undefined> {
  const workspace = await readPullWorkspaceBinding(directory)
  if (!workspace) return undefined
  const stateFile = path.join(workspace.directory, WORKFLOW_ACTIONS_STATE_RELATIVE_PATH)
  const legacyFile = path.join(workspace.directory, LEGACY_WORKFLOW_ACTIONS_RELATIVE_PATH)
  const [stateStat, legacyStat] = await Promise.all([stat(stateFile), stat(legacyFile)])
  if (legacyStat || !stateStat?.isFile()) return undefined
  const state = await readJsonFile<unknown>(stateFile)
  if (!isRecord(state) || state.appId !== workspace.appId) return undefined
  const baseline = isRecord(state.baseline) ? state.baseline : undefined
  if (baseline?.appId !== workspace.appId) return undefined
  try {
    return await loadWorkflowActionsWorkspace(workspace.directory)
  } catch (error) {
    throw new Error(
      `${errorMessage(error, 'The local workflow action workspace could not be loaded.')}\n` +
        'Fix the local workflow action files, or pass --force to replace them with the portal state.'
    )
  }
}
