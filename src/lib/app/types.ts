import { promises as fs } from 'node:fs'
import path from 'node:path'

import { writeTextFileAtomic } from '../shared/atomic-file.js'
import {
  getJsonSchema,
  type JsonSchema,
  type JsonSchemaName,
  type JsonSchemaWorkspaceResult,
  JSON_SCHEMA_NAMES,
  writeJsonSchemaWorkspace
} from './json-schema.js'
import { synchronizeTypeScriptConfig, type TypeScriptConfigResult } from './typescript-config.js'

export type { TypeScriptConfigResult } from './typescript-config.js'

export const DEFAULT_TYPES_FILENAME = 'ghl-app.d.ts'

const ROOT_TYPE_NAMES: Readonly<Record<JsonSchemaName, string>> = {
  app: 'GhlAppManifest',
  webhooks: 'GhlWebhookManifest',
  'workflow-action': 'GhlWorkflowActionManifest',
  'workflow-trigger': 'GhlWorkflowTriggerManifest',
  subscription: 'GhlSubscriptionManifest',
  'usage-based': 'GhlUsageBasedManifest'
}

const DEFINITION_PREFIXES: Readonly<Record<JsonSchemaName, string>> = {
  app: 'GhlApp',
  webhooks: 'GhlWebhook',
  'workflow-action': 'GhlWorkflowAction',
  'workflow-trigger': 'GhlWorkflowTrigger',
  subscription: 'GhlSubscription',
  'usage-based': 'GhlUsage'
}

const DEFINITION_STEM_PREFIXES: Readonly<Partial<Record<JsonSchemaName, string>>> = {
  'workflow-action': 'action',
  'workflow-trigger': 'trigger',
  subscription: 'subscription',
  'usage-based': 'usage'
}

const APP_NESTED_TYPES = [
  ['basicInfo', 'GhlBasicInfo'],
  ['listing', 'GhlListing'],
  ['profiles', 'GhlProfiles'],
  ['oauth', 'GhlOauth'],
  ['supportConfig', 'GhlSupportConfig'],
  ['billing', 'GhlBilling'],
  ['review', 'GhlReview']
] as const

interface DeclarationContext {
  definitionNames: ReadonlyMap<string, string>
  namedSchemas: ReadonlyMap<JsonSchema, string>
}

export interface TypeDeclarationOptions {
  generatedAt?: Date
  output?: string
}

export interface TypesWorkspaceResult extends JsonSchemaWorkspaceResult {
  declarationFile: string
  typescriptConfig: TypeScriptConfigResult
}

export interface TypeDeclarationWorkspaceResult {
  declarationFile: string
  typescriptConfig: TypeScriptConfigResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asSchema(value: unknown): JsonSchema | undefined {
  return isRecord(value) ? value : undefined
}

function pascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join('')
}

function definitionTypeName(schemaName: JsonSchemaName, definitionName: string): string {
  const stemPrefix = DEFINITION_STEM_PREFIXES[schemaName]
  const stem =
    stemPrefix && definitionName.startsWith(stemPrefix) ? definitionName.slice(stemPrefix.length) : definitionName
  return `${DEFINITION_PREFIXES[schemaName]}${pascalCase(stem)}`
}

function literalType(value: unknown): string {
  if (typeof value === 'string') {
    const escaped = JSON.stringify(value).slice(1, -1).replaceAll("'", "\\'")
    return `'${escaped}'`
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return 'unknown'
}

function propertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value)
}

function indent(level: number): string {
  return '  '.repeat(level)
}

function union(types: string[]): string {
  return [...new Set(types)].join(' | ') || 'never'
}

function primitiveType(value: unknown): string {
  if (value === 'string' || value === 'boolean' || value === 'number') return value
  if (value === 'integer') return 'number'
  if (value === 'null') return 'null'
  return 'unknown'
}

function renderObject(schema: JsonSchema, context: DeclarationContext, level: number): string {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter(value => typeof value === 'string') : []
  )
  const entries = Object.entries(properties).flatMap(([name, value]) => {
    const propertySchema = asSchema(value)
    if (!propertySchema) return []
    const optional = required.has(name) ? '' : '?'
    return [
      `${indent(level + 1)}readonly ${propertyName(name)}${optional}: ${renderType(propertySchema, context, level + 1)};`
    ]
  })

  if (entries.length === 0) {
    const additionalProperties = asSchema(schema.additionalProperties)
    if (additionalProperties) return `Readonly<Record<string, ${renderType(additionalProperties, context, level)}>>`
    return schema.additionalProperties === false
      ? 'Readonly<Record<string, never>>'
      : 'Readonly<Record<string, unknown>>'
  }

  return ['{', ...entries, `${indent(level)}}`].join('\n')
}

function renderType(schema: JsonSchema, context: DeclarationContext, level: number): string {
  const namedType = context.namedSchemas.get(schema)
  if (namedType) return namedType

  if (typeof schema.$ref === 'string') {
    const definitionName = schema.$ref.match(/^#\/definitions\/([^/]+)$/)?.[1]
    return (definitionName && context.definitionNames.get(definitionName)) || 'unknown'
  }
  if (Object.hasOwn(schema, 'const')) return literalType(schema.const)
  if (Array.isArray(schema.enum)) return union(schema.enum.map(literalType))
  if (Array.isArray(schema.anyOf)) {
    return union(schema.anyOf.flatMap(value => (asSchema(value) ? [renderType(value, context, level)] : [])))
  }
  if (Array.isArray(schema.type)) return union(schema.type.map(primitiveType))
  if (schema.type === 'array') {
    const itemSchema = asSchema(schema.items)
    return `ReadonlyArray<${itemSchema ? renderType(itemSchema, context, level) : 'unknown'}>`
  }
  if (schema.type === 'object' || isRecord(schema.properties) || schema.additionalProperties !== undefined) {
    return renderObject(schema, context, level)
  }
  return primitiveType(schema.type)
}

function renderInterface(name: string, schema: JsonSchema, context: DeclarationContext): string {
  return `export interface ${name} ${renderObject(schema, context, 0)}`
}

function definitions(schema: JsonSchema): Record<string, JsonSchema> {
  if (!isRecord(schema.definitions)) return {}
  return Object.fromEntries(
    Object.entries(schema.definitions).flatMap(([name, value]) => {
      const definition = asSchema(value)
      return definition ? [[name, definition]] : []
    })
  )
}

function appNestedSchemas(schema: JsonSchema): Array<{ name: string; schema: JsonSchema }> {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  return APP_NESTED_TYPES.flatMap(([property, name]) => {
    const nestedSchema = asSchema(properties[property])
    return nestedSchema ? [{ name, schema: nestedSchema }] : []
  })
}

function declarationsForSchema(schemaName: JsonSchemaName, schema: JsonSchema): string[] {
  const schemaDefinitions = definitions(schema)
  const definitionNames = new Map(
    Object.keys(schemaDefinitions).map(name => [name, definitionTypeName(schemaName, name)] as const)
  )
  const nestedSchemas = schemaName === 'app' ? appNestedSchemas(schema) : []
  const namedSchemas = new Map<JsonSchema, string>(nestedSchemas.map(item => [item.schema, item.name]))
  const context: DeclarationContext = { definitionNames, namedSchemas }
  const declarations = [renderInterface(ROOT_TYPE_NAMES[schemaName], schema, context)]

  for (const nested of nestedSchemas) declarations.push(renderInterface(nested.name, nested.schema, context))
  for (const [name, definition] of Object.entries(schemaDefinitions)) {
    const typeName = definitionNames.get(name) as string
    const renderedType = renderType(definition, context, 0)
    declarations.push(
      renderedType.startsWith('{')
        ? `export interface ${typeName} ${renderedType}`
        : `export type ${typeName} = ${renderedType};`
    )
  }
  return declarations
}

export function generateTypeDeclarations(generatedAt = new Date()): string {
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Generated-at timestamp must be a valid date.')
  const header = [
    '/*',
    ` * Generated by @gohighlevel/marketplace-cli on ${generatedAt.toISOString()}.`,
    ' * Run `ghl app types` to regenerate after pulling or editing config.',
    ' * Do not edit manually; changes will be overwritten.',
    ' */'
  ].join('\n')
  const declarations = JSON_SCHEMA_NAMES.flatMap(name => declarationsForSchema(name, getJsonSchema(name)))
  return `${header}\n\n${declarations.join('\n\n')}\n`
}

async function lstatIfPresent(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function resolveSafeOutputFile(directory: string, output: string): Promise<string> {
  if (!output.trim()) throw new Error('Type declaration output path is required.')
  const outputFile = path.resolve(directory, output)
  const relativeOutput = path.relative(directory, outputFile)
  if (
    !relativeOutput ||
    relativeOutput === '..' ||
    relativeOutput.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutput)
  ) {
    throw new Error('Type declaration output must stay inside the app workspace.')
  }
  if (!outputFile.endsWith('.d.ts')) throw new Error('Type declaration output must use the .d.ts extension.')

  const workspaceStat = await lstatIfPresent(directory)
  if (!workspaceStat) throw new Error(`App workspace "${directory}" does not exist.`)
  if (workspaceStat.isSymbolicLink()) throw new Error(`App workspace "${directory}" cannot be a symbolic link.`)
  if (!workspaceStat.isDirectory()) throw new Error(`App workspace "${directory}" is not a directory.`)

  let current = directory
  const parentParts = path
    .dirname(relativeOutput)
    .split(path.sep)
    .filter(part => part !== '.')
  for (const part of parentParts) {
    current = path.join(current, part)
    const currentStat = await lstatIfPresent(current)
    if (!currentStat) continue
    if (currentStat.isSymbolicLink())
      throw new Error(`Type declaration directory "${current}" cannot be a symbolic link.`)
    if (!currentStat.isDirectory()) throw new Error(`Type declaration path "${current}" is not a directory.`)
  }

  const outputStat = await lstatIfPresent(outputFile)
  if (outputStat?.isSymbolicLink()) throw new Error(`Type declaration file "${outputFile}" cannot be a symbolic link.`)
  if (outputStat && !outputStat.isFile())
    throw new Error(`Type declaration path "${outputFile}" is not a regular file.`)
  return outputFile
}

export async function writeTypeDeclarationFile(
  inputDirectory: string,
  options: TypeDeclarationOptions = {}
): Promise<string> {
  const directory = path.resolve(inputDirectory)
  const outputFile = await resolveSafeOutputFile(directory, options.output ?? DEFAULT_TYPES_FILENAME)
  await fs.mkdir(path.dirname(outputFile), { recursive: true, mode: 0o755 })
  await writeTextFileAtomic(outputFile, generateTypeDeclarations(options.generatedAt), 0o644)
  return outputFile
}

export async function writeTypesWorkspace(
  inputDirectory: string,
  options: TypeDeclarationOptions = {}
): Promise<TypesWorkspaceResult> {
  const directory = path.resolve(inputDirectory)
  const typeDeclaration = await writeTypeDeclarationWorkspace(directory, options)
  const schemaResult = await writeJsonSchemaWorkspace(directory)
  return { ...typeDeclaration, ...schemaResult }
}

export async function writeTypeDeclarationWorkspace(
  inputDirectory: string,
  options: TypeDeclarationOptions = {}
): Promise<TypeDeclarationWorkspaceResult> {
  const directory = path.resolve(inputDirectory)
  const declarationFile = await writeTypeDeclarationFile(directory, options)
  const typescriptConfig = await synchronizeTypeScriptConfig(directory, declarationFile)
  return { declarationFile, typescriptConfig }
}
