import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeTextFileAtomic } from '../shared/atomic-file.js'
import { appSchema } from './json-schemas/app.js'
import { subscriptionSchema, usageBasedSchema } from './json-schemas/billing.js'
import type { JsonSchema } from './json-schemas/builders.js'
import {
  JSON_SCHEMA_NAMES,
  JSON_SCHEMA_REFERENCES,
  JSON_SCHEMA_RELATIVE_PATHS,
  type JsonSchemaName
} from './json-schemas/names.js'
import { webhookSchema } from './json-schemas/webhooks.js'
import { workflowActionSchema } from './json-schemas/workflow-action.js'
import { workflowTriggerSchema } from './json-schemas/workflow-trigger.js'

export {
  JSON_SCHEMA_NAMES,
  JSON_SCHEMA_REFERENCES,
  JSON_SCHEMA_RELATIVE_PATHS,
  type JsonSchemaName
} from './json-schemas/names.js'
export type { JsonSchema } from './json-schemas/builders.js'

const JSON_SCHEMAS: Readonly<Record<JsonSchemaName, JsonSchema>> = {
  app: appSchema,
  webhooks: webhookSchema,
  'workflow-action': workflowActionSchema,
  'workflow-trigger': workflowTriggerSchema,
  subscription: subscriptionSchema,
  'usage-based': usageBasedSchema
}

const JSON_SCHEMA_FILE_MATCHES: Readonly<Record<JsonSchemaName, string[]>> = {
  app: ['ghl-app.json'],
  webhooks: ['src/webhooks/ghl-webhooks.json'],
  'workflow-action': ['src/modules/workflows/actions/*.json'],
  'workflow-trigger': ['src/modules/workflows/triggers/*.json'],
  subscription: ['src/billing/subscription.json'],
  'usage-based': ['src/billing/usage-based.json']
}

export interface JsonSchemaWorkspaceResult {
  schemaDirectory: string
  schemaFiles: string[]
  vscodeSettingsFile: string
  vscodeSettingsCreated: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function withJsonSchemaReference<T extends object>(value: T, name: JsonSchemaName): T & { $schema: string } {
  const source = value as T & { $schema?: unknown }
  const { $schema: _schema, ...manifest } = source
  return { $schema: JSON_SCHEMA_REFERENCES[name], ...manifest } as T & { $schema: string }
}

export function withoutJsonSchemaReference<T>(value: T): T {
  if (!isRecord(value) || !Object.hasOwn(value, '$schema')) return value
  const { $schema: _schema, ...manifest } = value
  return manifest as T
}

export function getJsonSchema(name: JsonSchemaName): JsonSchema {
  return structuredClone(JSON_SCHEMAS[name])
}

async function lstatIfPresent(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function assertSchemaPathsSafe(directory: string): Promise<void> {
  const workspaceStat = await lstatIfPresent(directory)
  if (!workspaceStat) throw new Error(`App workspace "${directory}" does not exist.`)
  if (workspaceStat.isSymbolicLink()) throw new Error(`App workspace "${directory}" cannot be a symbolic link.`)
  if (!workspaceStat.isDirectory()) throw new Error(`App workspace "${directory}" is not a directory.`)

  for (const [relativePath, label] of [
    ['.ghl', 'Workspace state directory'],
    [path.join('.ghl', 'schemas'), 'JSON schema directory']
  ] as const) {
    const target = path.join(directory, relativePath)
    const stat = await lstatIfPresent(target)
    if (!stat) continue
    if (stat.isSymbolicLink()) throw new Error(`${label} "${target}" cannot be a symbolic link.`)
    if (!stat.isDirectory()) throw new Error(`${label} "${target}" is not a directory.`)
  }

  for (const name of JSON_SCHEMA_NAMES) {
    const file = path.join(directory, JSON_SCHEMA_RELATIVE_PATHS[name])
    const stat = await lstatIfPresent(file)
    if (!stat) continue
    if (stat.isSymbolicLink()) throw new Error(`JSON schema file "${file}" cannot be a symbolic link.`)
    if (!stat.isFile()) throw new Error(`JSON schema path "${file}" is not a regular file.`)
  }
}

async function writeSchemaIfChanged(file: string, schema: JsonSchema): Promise<void> {
  const contents = `${JSON.stringify(schema, null, 2)}\n`
  try {
    if ((await fs.readFile(file, 'utf8')) === contents) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await writeTextFileAtomic(file, contents, 0o644)
}

async function createVscodeSettings(directory: string): Promise<{ created: boolean; file: string }> {
  const vscodeDirectory = path.join(directory, '.vscode')
  const settingsFile = path.join(vscodeDirectory, 'settings.json')
  const vscodeStat = await lstatIfPresent(vscodeDirectory)
  if (vscodeStat && (!vscodeStat.isDirectory() || vscodeStat.isSymbolicLink())) {
    return { created: false, file: settingsFile }
  }
  if (await lstatIfPresent(settingsFile)) return { created: false, file: settingsFile }

  await fs.mkdir(vscodeDirectory, { recursive: true, mode: 0o755 })
  const settings = {
    'json.schemas': JSON_SCHEMA_NAMES.map(name => ({
      fileMatch: JSON_SCHEMA_FILE_MATCHES[name],
      url: `./${JSON_SCHEMA_RELATIVE_PATHS[name]}`
    }))
  }
  try {
    await fs.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644
    })
    return { created: true, file: settingsFile }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { created: false, file: settingsFile }
    throw error
  }
}

export async function writeJsonSchemaWorkspace(inputDirectory: string): Promise<JsonSchemaWorkspaceResult> {
  const directory = path.resolve(inputDirectory)
  await assertSchemaPathsSafe(directory)
  const schemaDirectory = path.join(directory, '.ghl', 'schemas')
  await fs.mkdir(schemaDirectory, { recursive: true, mode: 0o700 })
  const schemaFiles = JSON_SCHEMA_NAMES.map(name => path.join(directory, JSON_SCHEMA_RELATIVE_PATHS[name]))
  await Promise.all(
    JSON_SCHEMA_NAMES.map((name, index) => writeSchemaIfChanged(schemaFiles[index], JSON_SCHEMAS[name]))
  )
  const vscode = await createVscodeSettings(directory)
  return {
    schemaDirectory,
    schemaFiles,
    vscodeSettingsFile: vscode.file,
    vscodeSettingsCreated: vscode.created
  }
}
