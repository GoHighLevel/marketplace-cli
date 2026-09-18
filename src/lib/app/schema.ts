import { isRecord } from '../api/response.js'
import { type AppFiles } from './manifest.js'
import { validateJsonSchemaStructure } from './json-schema.js'
import { type WorkspaceState } from './workspace.js'

const APP_RESOURCE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/

export function isAppResourceIdentifier(value: unknown): value is string {
  return typeof value === 'string' && APP_RESOURCE_IDENTIFIER.test(value)
}

function validateWorkspaceFiles(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object.`]
  const errors = Object.keys(value)
    .filter(key => !['app', 'webhooks'].includes(key))
    .map(key => `${path}.${key} is not a supported property.`)
  if (!Object.hasOwn(value, 'app')) errors.push(`${path}.app is required.`)
  else errors.push(...validateJsonSchemaStructure('app', value.app, `${path}.app`))
  if (!Object.hasOwn(value, 'webhooks')) errors.push(`${path}.webhooks is required.`)
  else errors.push(...validateJsonSchemaStructure('webhooks', value.webhooks, `${path}.webhooks`))
  return errors
}

function validateWorkspaceState(value: unknown): string[] {
  const path = '.ghl/state.json'
  if (!isRecord(value)) return [`${path} must be an object.`]
  const errors = Object.keys(value)
    .filter(key => !['schemaVersion', 'appId', 'versionId', 'baseline'].includes(key))
    .map(key => `${path}.${key} is not a supported property.`)
  if (value.schemaVersion !== 1) errors.push(`${path}.schemaVersion must be 1.`)
  for (const field of ['appId', 'versionId']) {
    const fieldPath = `${path}.${field}`
    if (typeof value[field] !== 'string') errors.push(`${fieldPath} must be a string.`)
    else if (!isAppResourceIdentifier(value[field])) {
      errors.push(
        `${fieldPath} must contain only letters, numbers, underscores, or hyphens and be 1 to 128 characters.`
      )
    }
  }
  if (!Object.hasOwn(value, 'baseline')) errors.push(`${path}.baseline is required.`)
  else errors.push(...validateWorkspaceFiles(value.baseline, `${path}.baseline`))
  return errors
}

export function validateAppWorkspaceSchema(files: AppFiles, state: WorkspaceState): string[] {
  return [...validateWorkspaceFiles(files, 'workspace'), ...validateWorkspaceState(state)]
}
