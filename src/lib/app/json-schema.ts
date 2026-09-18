import { promises as fs } from 'node:fs'
import path from 'node:path'
import AjvModule, { type Ajv as AjvInstance, type ErrorObject, type Options, type ValidateFunction } from 'ajv'
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

const Ajv = AjvModule as unknown as new (options?: Options) => AjvInstance

/* Conditional subschemas intentionally inherit property declarations from
   their parent contract. `verbose` attaches the failing subschema to each
   error so `not` rules can name the property they reject. */
const schemaValidator = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  strictNumbers: true,
  strictRequired: false,
  strictTypes: false,
  useDefaults: false,
  verbose: true
})
const compiledValidators = new Map<JsonSchemaName, ValidateFunction>()

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

function pathSegment(parent: string, segment: string): string {
  if (/^(?:0|[1-9]\d*)$/.test(segment)) return `${parent}[${segment}]`
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment) ? `${parent}.${segment}` : `${parent}[${JSON.stringify(segment)}]`
}

function instancePath(rootPath: string, pointer: string): string {
  return pointer
    .split('/')
    .slice(1)
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce(pathSegment, rootPath)
}

function countLabel(value: number, noun: string): string {
  return `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`
}

function errorPath(error: ErrorObject, rootPath: string): string {
  const base = instancePath(rootPath, error.instancePath)
  if (error.keyword === 'additionalProperties') {
    return pathSegment(base, String(error.params.additionalProperty))
  }
  if (error.keyword === 'required') return pathSegment(base, String(error.params.missingProperty))
  return base
}

function enumValues(error: ErrorObject): string {
  const values = Array.isArray(error.params.allowedValues) ? error.params.allowedValues : []
  return values.map(value => JSON.stringify(value)).join(', ')
}

function typeLabel(expected: string): string {
  if (expected === 'null') return 'null'
  return `${/^[aeiou]/i.test(expected) ? 'an' : 'a'} ${expected}`
}

/* A `not` rule built from `required` alternatives forbids properties; the
   verbose error carries that subschema, so the present properties can be named. */
function forbiddenProperties(error: ErrorObject): string[] {
  const schema = isRecord(error.schema) ? error.schema : undefined
  if (!schema || !isRecord(error.data)) return []
  const alternatives = Array.isArray(schema.anyOf) ? schema.anyOf : [schema]
  const data = error.data
  return alternatives.flatMap(alternative =>
    isRecord(alternative) && Array.isArray(alternative.required)
      ? alternative.required.filter(
          (property): property is string => typeof property === 'string' && Object.hasOwn(data, property)
        )
      : []
  )
}

function jsonSchemaErrors(error: ErrorObject, rootPath: string): string[] {
  const path = errorPath(error, rootPath)
  switch (error.keyword) {
    case 'additionalProperties':
      return [`${path} is not a supported property.`]
    case 'required':
      return [`${path} is required.`]
    case 'type':
      return [`${path} must be ${String(error.params.type).split(',').map(typeLabel).join(' or ')}.`]
    case 'const':
      return [`${path} must be ${JSON.stringify(error.params.allowedValue)}.`]
    case 'enum':
      return [`${path} must be one of: ${enumValues(error)}.`]
    case 'minLength':
      return [`${path} must contain at least ${countLabel(Number(error.params.limit), 'character')}.`]
    case 'maxLength':
      return [`${path} must contain at most ${countLabel(Number(error.params.limit), 'character')}.`]
    case 'minItems':
      return [`${path} must contain at least ${countLabel(Number(error.params.limit), 'item')}.`]
    case 'maxItems':
      return [`${path} must contain at most ${countLabel(Number(error.params.limit), 'item')}.`]
    case 'minProperties':
      return [`${path} must contain at least ${countLabel(Number(error.params.limit), 'property')}.`]
    case 'uniqueItems':
      return [`${path} must not contain duplicate items.`]
    case 'minimum':
      return [`${path} must be at least ${error.params.limit}.`]
    case 'maximum':
      return [`${path} must be at most ${error.params.limit}.`]
    case 'exclusiveMinimum':
      return [`${path} must be greater than ${error.params.limit}.`]
    case 'exclusiveMaximum':
      return [`${path} must be less than ${error.params.limit}.`]
    case 'pattern':
      if (/\/properties\/(?:appId|versionId)\/pattern$/.test(error.schemaPath)) {
        return [`${path} must contain only letters, numbers, underscores, or hyphens and be 1 to 128 characters.`]
      }
      return [`${path} does not match the required format.`]
    case 'propertyNames':
      return [`${pathSegment(path, String(error.params.propertyName))} is not a supported property name.`]
    case 'oneOf':
      return [`${path} must match exactly one supported configuration.`]
    case 'anyOf':
      return [`${path} must match a supported configuration.`]
    case 'not': {
      const forbidden = forbiddenProperties(error)
      if (forbidden.length === 0) return [`${path} contains a value that is not supported here.`]
      return forbidden.map(property => `${pathSegment(path, property)} is not supported here.`)
    }
    case 'if':
      return []
    default:
      return [`${path} ${error.message ?? `failed ${error.keyword} validation`}.`]
  }
}

/* Errors raised inside a oneOf/anyOf alternative or a propertyNames subschema
   only explain why one alternative failed; the enclosing keyword carries the
   actionable message. */
function isAlternativeDetail(error: ErrorObject): boolean {
  return /\/(?:oneOf|anyOf)\/\d+\//.test(error.schemaPath) || /\/propertyNames\//.test(error.schemaPath)
}

function validatorFor(name: JsonSchemaName): ValidateFunction {
  const existing = compiledValidators.get(name)
  if (existing) return existing
  const compiled = schemaValidator.compile(JSON_SCHEMAS[name])
  compiledValidators.set(name, compiled)
  return compiled
}

export function validateJsonSchema(name: JsonSchemaName, value: unknown, rootPath: string): string[] {
  const validator = validatorFor(name)
  if (validator(value)) return []
  return formatJsonSchemaErrors(validator.errors ?? [], rootPath)
}

function formatJsonSchemaErrors(errors: ErrorObject[], rootPath: string): string[] {
  return [
    ...new Set(errors.filter(error => !isAlternativeDetail(error)).flatMap(error => jsonSchemaErrors(error, rootPath)))
  ]
}

function isConditionalSchemaPath(schemaPath: string): boolean {
  return /\/(?:allOf|anyOf|oneOf|if|then|else|not)\//.test(schemaPath)
}

/* Structural errors are the shape problems a workspace cannot be loaded with:
   unknown or missing properties, wrong value types, and fixed protocol values.
   Conditional rules and catalog memberships (enumerated array items such as
   categories) remain editor and push-time concerns so that a manifest pulled
   from the portal always loads, as it did before the schemas existed. */
function isStructuralError(error: ErrorObject): boolean {
  if (error.keyword === 'additionalProperties') return true
  if (isConditionalSchemaPath(error.schemaPath)) return false
  if (['type', 'const', 'required'].includes(error.keyword)) return true
  if (error.keyword === 'enum') return !/\/items\//.test(error.schemaPath)
  return error.keyword === 'pattern' && /\/properties\/(?:appId|versionId)\/pattern$/.test(error.schemaPath)
}

export function validateJsonSchemaStructure(name: JsonSchemaName, value: unknown, rootPath: string): string[] {
  const validator = validatorFor(name)
  if (validator(value)) return []
  return formatJsonSchemaErrors((validator.errors ?? []).filter(isStructuralError), rootPath)
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
