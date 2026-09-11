import { isRecord } from '../../api/response.js'
import {
  optionalString,
  requireArray,
  requireRecord,
  requiredString,
  unknownProperties
} from '../shared/schema-primitives.js'
import { workflowActionKeyValidationErrors } from './key.js'
import type {
  WorkflowActionDefinition,
  WorkflowActionInput,
  WorkflowActionVersion,
  WorkflowActionsManifest
} from './manifest.js'
import { rejectRemoteSecretReferences } from './validation/headers.js'
import { validateVersion, type WorkflowActionValidationOptions } from './validation/version.js'

export type { WorkflowActionValidationOptions } from './validation/version.js'

function validateAction(
  value: unknown,
  path: string,
  keys: Set<string>,
  templates: Set<string>,
  options: WorkflowActionValidationOptions,
  errors: string[]
): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(value, new Set(['templateId', 'key', 'versions']), path, errors)
  optionalString(value.templateId, `${path}.templateId`, errors)
  if (typeof value.templateId === 'string' && value.templateId) {
    if (templates.has(value.templateId)) errors.push(`${path}.templateId duplicates "${value.templateId}".`)
    templates.add(value.templateId)
  }
  if (requiredString(value.key, `${path}.key`, errors)) {
    errors.push(...workflowActionKeyValidationErrors(value.key).map(error => `${path}.key ${error}.`))
    const lower = value.key.toLowerCase()
    if (keys.has(lower)) errors.push(`${path}.key duplicates action key "${value.key}".`)
    keys.add(lower)
  }
  if (!requireArray(value.versions, `${path}.versions`, errors)) return
  if (value.versions.length === 0) errors.push(`${path}.versions must contain at least one version.`)
  const versions = new Set<string>()
  let draftCount = 0
  value.versions.forEach((version, index) => {
    if (isRecord(version)) {
      if (typeof version.version === 'string') {
        if (versions.has(version.version))
          errors.push(`${path}.versions[${index}].version duplicates "${version.version}".`)
        versions.add(version.version)
      }
      if (version.status === 'draft') draftCount += 1
    }
    validateVersion(
      version,
      `${path}.versions[${index}]`,
      value as unknown as WorkflowActionDefinition,
      options,
      errors
    )
  })
  if (draftCount > 1) errors.push(`${path}.versions may contain only one draft version.`)
  if (!value.templateId) {
    if (
      value.versions.length !== 1 ||
      !isRecord(value.versions[0]) ||
      value.versions[0].version !== '1.0' ||
      value.versions[0].status !== 'draft'
    ) {
      errors.push(`${path} without a templateId must contain only a local draft at version 1.0.`)
    }
    rejectRemoteSecretReferences(value, path, errors)
  }
}

export function validateWorkflowActionsManifest(
  value: unknown,
  options: WorkflowActionValidationOptions = {}
): string[] {
  const errors: string[] = []
  const path = 'workflow-actions.json'
  if (!requireRecord(value, path, errors)) return errors
  unknownProperties(value, new Set(['schemaVersion', 'appId', 'actions']), path, errors)
  if (value.schemaVersion !== 1) errors.push(`${path}.schemaVersion must be 1.`)
  requiredString(value.appId, `${path}.appId`, errors)
  if (!requireArray(value.actions, `${path}.actions`, errors)) return errors
  if (value.actions.length > 30) errors.push(`${path}.actions supports at most 30 actions per app.`)
  const keys = new Set<string>()
  const templates = new Set<string>()
  value.actions.forEach((action, index) =>
    validateAction(action, `${path}.actions[${index}]`, keys, templates, options, errors)
  )
  if (options.publishable) {
    const actions = value.actions.filter(isRecord)
    const target = options.actionKey ? actions.find(action => action.key === options.actionKey) : undefined
    if (options.actionKey && !target) {
      errors.push(`${path} action "${options.actionKey}" was not found.`)
    } else if (target) {
      const versions = Array.isArray(target.versions) ? target.versions.filter(isRecord) : []
      const version = options.version
        ? versions.find(candidate => candidate.version === options.version)
        : versions.find(candidate => candidate.status === 'draft')
      if (!version) {
        const suffix = options.version ? ` version ${options.version}` : ''
        errors.push(`${path} action "${options.actionKey}"${suffix} was not found as an editable draft.`)
      } else if (version.status !== 'draft') {
        errors.push(`${path} action "${options.actionKey}" version ${version.version} is not an editable draft.`)
      }
    } else if (
      !actions.some(
        action =>
          Array.isArray(action.versions) &&
          action.versions.some(version => isRecord(version) && version.status === 'draft')
      )
    ) {
      errors.push(`${path} contains no draft workflow action to validate for publication.`)
    }
  }
  return errors
}

export function validateWorkflowActionVersionForPublish(
  manifest: WorkflowActionsManifest,
  actionKey: string,
  version: string
): string[] {
  return validateWorkflowActionsManifest(manifest, { publishable: true, actionKey, version })
}

export function isWorkflowActionsManifest(value: unknown): value is WorkflowActionsManifest {
  return validateWorkflowActionsManifest(value).length === 0
}

export function draftVersion(action: WorkflowActionDefinition): WorkflowActionVersion | undefined {
  return action.versions.find(version => version.status === 'draft')
}

export function findActionInput(action: WorkflowActionDefinition, field: string): WorkflowActionInput | undefined {
  return draftVersion(action)?.inputs?.find(input => input.field === field)
}
