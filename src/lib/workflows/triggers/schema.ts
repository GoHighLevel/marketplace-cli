import { isRecord } from '../../api/response.js'
import { workflowActionKeyValidationErrors } from '../actions/key.js'
import {
  WORKFLOW_TRIGGER_FIELD_TYPES,
  WORKFLOW_TRIGGER_INTERNAL_REFERENCES
} from './contract.js'
import {
  WorkflowTriggerDefinition,
  WorkflowTriggersManifest,
  WorkflowTriggerVersion
} from './manifest.js'
import { validateHttpUrl, validateHttpsUrl, validateTextForWhiteLabel } from '../../shared/validation.js'
import {
  isWorkflowSecretReference,
  WORKFLOW_ENV_REFERENCE,
  WORKFLOW_REMOTE_REFERENCE,
  workflowHeaderRequiresReference
} from '../shared/secret-references.js'
import {
  containsWhitespace,
  isWorkflowVersion,
  WORKFLOW_REFERENCE_MAX_LENGTH,
  WORKFLOW_VERSION_MAX_LENGTH
} from '../shared/value-validation.js'

export interface WorkflowTriggerValidationOptions {
  publishable?: boolean
  triggerKey?: string
  version?: string
  whiteLabel?: boolean
}

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const STATUSES = new Set(['draft', 'in_review', 'published'])
const FIELD_TYPES = new Set<string>(WORKFLOW_TRIGGER_FIELD_TYPES)
const INTERNAL_REFERENCES = new Set<string>(WORKFLOW_TRIGGER_INTERNAL_REFERENCES)
const CUSTOM_VARIABLE_TYPES = new Set(['array', 'boolean', 'date', 'numerical', 'string'])
const FILTER_PROPERTIES = new Set([
  'field',
  'title',
  'required',
  'fieldType',
  'options',
  'fetchOptions',
  'mappedTo',
  'altersDynamicField',
  'dynamicFieldsConfig'
])

function propertyPath(path: string, property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(property)
    ? `${path}.${property}`
    : `${path}[${JSON.stringify(property)}]`
}

function unknownProperties(value: unknown, allowed: Set<string>, path: string, errors: string[]): void {
  if (!isRecord(value)) return
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${propertyPath(path, key)} is not a supported property.`)
  }
}

function requireRecord(value: unknown, path: string, errors: string[]): value is Record<string, unknown> {
  if (isRecord(value)) return true
  errors.push(`${path} must be an object.`)
  return false
}

function requireArray(value: unknown, path: string, errors: string[]): value is unknown[] {
  if (Array.isArray(value)) return true
  errors.push(`${path} must be an array.`)
  return false
}

function requiredString(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value === 'string' && value.trim()) return true
  errors.push(`${path} must be a non-empty string.`)
  return false
}

function optionalString(value: unknown, path: string, errors: string[]): void {
  if (value !== undefined && typeof value !== 'string') errors.push(`${path} must be a string.`)
}

function optionalBoolean(value: unknown, path: string, errors: string[]): void {
  if (value !== undefined && typeof value !== 'boolean') errors.push(`${path} must be a boolean.`)
}

function stringArray(value: unknown, path: string, errors: string[]): void {
  if (!requireArray(value, path, errors)) return
  value.forEach((item, index) => {
    if (typeof item !== 'string') errors.push(`${path}[${index}] must be a string.`)
  })
}

function validateHeaders(value: unknown, path: string, errors: string[]): void {
  if (!requireRecord(value, path, errors)) return
  for (const [name, headerValue] of Object.entries(value)) {
    const headerPath = propertyPath(path, name)
    if (!HEADER_NAME.test(name)) errors.push(`${headerPath} must be a valid HTTP header name.`)
    if (typeof headerValue !== 'string' || !headerValue) {
      errors.push(`${headerPath} must be a non-empty string.`)
      continue
    }
    const looksLikeReference = headerValue.startsWith('${') || headerValue.endsWith('}')
    if (looksLikeReference && !isWorkflowSecretReference(headerValue)) {
      errors.push(`${headerPath} must use "${WORKFLOW_REMOTE_REFERENCE}" or "\${env:VARIABLE_NAME}" reference syntax.`)
    }
    if (
      workflowHeaderRequiresReference(name) &&
      headerValue !== WORKFLOW_REMOTE_REFERENCE &&
      !WORKFLOW_ENV_REFERENCE.test(headerValue)
    ) {
      errors.push(`${headerPath} is sensitive and must use an environment or remote-preservation reference.`)
    }
  }
}

function validatePublicUrl(
  value: unknown,
  path: string,
  errors: string[],
  protocol: 'http' | 'https',
  required = false
): void {
  if (value === undefined || value === '') {
    if (required) errors.push(`${path} is required.`)
    return
  }
  if (typeof value !== 'string') {
    errors.push(`${path} must be a string.`)
    return
  }
  const result = protocol === 'https'
    ? validateHttpsUrl(value, path, { publicOnly: true })
    : validateHttpUrl(value, path, { publicOnly: true })
  if (result !== true) errors.push(result)
}

function validateOptions(value: unknown, path: string, errors: string[]): void {
  if (!requireArray(value, path, errors)) return
  if (value.length === 0) errors.push(`${path} must contain at least one option.`)
  const values = new Set<string>()
  value.forEach((option, index) => {
    const optionPath = `${path}[${index}]`
    if (!requireRecord(option, optionPath, errors)) return
    unknownProperties(option, new Set(['label', 'value', 'description', 'disabled', 'icon', 'iconUrl']), optionPath, errors)
    requiredString(option.label, `${optionPath}.label`, errors)
    if (requiredString(option.value, `${optionPath}.value`, errors)) {
      if (values.has(option.value)) errors.push(`${optionPath}.value duplicates option value "${option.value}".`)
      values.add(option.value)
    }
    optionalString(option.description, `${optionPath}.description`, errors)
    optionalBoolean(option.disabled, `${optionPath}.disabled`, errors)
    optionalString(option.icon, `${optionPath}.icon`, errors)
    optionalString(option.iconUrl, `${optionPath}.iconUrl`, errors)
    validatePublicUrl(option.iconUrl, `${optionPath}.iconUrl`, errors, 'https')
  })
}

function validateExternalSource(value: unknown, path: string, errors: string[]): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(value, new Set(['url', 'headers']), path, errors)
  validatePublicUrl(value.url, `${path}.url`, errors, 'https', true)
  if (value.headers !== undefined) validateHeaders(value.headers, `${path}.headers`, errors)
}

function triggerDataReference(
  triggerData: Record<string, unknown>,
  reference: string
): { found: boolean; type?: string } {
  let current: unknown = triggerData
  for (const segment of reference.split('.')) {
    if (!segment || !isRecord(current) || !Object.hasOwn(current, segment)) return { found: false }
    current = current[segment]
  }
  if (Array.isArray(current)) return { found: true, type: current.length > 0 ? 'array' : undefined }
  if (current === null || isRecord(current)) return { found: true }
  if (typeof current === 'number') return { found: true, type: Number.isFinite(current) ? 'numerical' : undefined }
  if (typeof current === 'string' || typeof current === 'boolean') return { found: true, type: typeof current }
  return { found: true }
}

function validateFilter(
  value: unknown,
  triggerData: unknown,
  path: string,
  fields: Set<string>,
  errors: string[]
): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(value, FILTER_PROPERTIES, path, errors)
  const isDynamic = value.fieldType === 'DYNAMIC'
  if (requiredString(value.field, `${path}.field`, errors)) {
    if (value.field.length > WORKFLOW_REFERENCE_MAX_LENGTH) {
      errors.push(`${path}.field must be at most ${WORKFLOW_REFERENCE_MAX_LENGTH.toLocaleString('en-US')} characters.`)
    } else {
      if (containsWhitespace(value.field)) errors.push(`${path}.field must not contain whitespace.`)
      if (fields.has(value.field)) errors.push(`${path}.field duplicates filter field "${value.field}".`)
      fields.add(value.field)
    }
  }
  requiredString(value.title, `${path}.title`, errors)
  if (requiredString(value.fieldType, `${path}.fieldType`, errors) && !FIELD_TYPES.has(value.fieldType)) {
    errors.push(`${path}.fieldType must be one of: ${[...FIELD_TYPES].join(', ')}.`)
  }
  optionalBoolean(value.required, `${path}.required`, errors)
  optionalBoolean(value.altersDynamicField, `${path}.altersDynamicField`, errors)
  if (value.options !== undefined) validateOptions(value.options, `${path}.options`, errors)
  if (value.fetchOptions !== undefined) validateExternalSource(value.fetchOptions, `${path}.fetchOptions`, errors)
  if (value.dynamicFieldsConfig !== undefined) {
    validateExternalSource(value.dynamicFieldsConfig, `${path}.dynamicFieldsConfig`, errors)
  }
  if (value.mappedTo !== undefined) {
    if (requiredString(value.mappedTo, `${path}.mappedTo`, errors) && !INTERNAL_REFERENCES.has(value.mappedTo)) {
      errors.push(`${path}.mappedTo must be one of: ${[...INTERNAL_REFERENCES].join(', ')}.`)
    }
  }

  const optionSources = ['options', 'mappedTo', 'fetchOptions'].filter(source => value[source] !== undefined)
  if (value.fieldType === 'select' || value.fieldType === 'multiselect') {
    if (optionSources.length !== 1) {
      errors.push(`${path} must define exactly one option source: options, mappedTo, or fetchOptions.`)
    }
  } else if (optionSources.length > 0) {
    errors.push(`${path} option sources are supported only for select and multiselect filters.`)
  }

  if (isDynamic) {
    if (value.field !== 'DYNAMIC') errors.push(`${path}.field must be "DYNAMIC" for a dynamic filter.`)
    if (value.required === true) errors.push(`${path}.required must be false for a dynamic filter.`)
    if (!isRecord(value.dynamicFieldsConfig)) {
      errors.push(`${path}.dynamicFieldsConfig is required for a dynamic filter.`)
    }
    if (value.altersDynamicField !== undefined) {
      errors.push(`${path}.altersDynamicField is not supported for a dynamic filter.`)
    }
    return
  }
  if (value.dynamicFieldsConfig !== undefined) {
    errors.push(`${path}.dynamicFieldsConfig is supported only for a dynamic filter.`)
  }
  if (
    !isRecord(triggerData) ||
    typeof value.field !== 'string' ||
    !value.field ||
    value.field.length > WORKFLOW_REFERENCE_MAX_LENGTH
  ) return
  const reference = triggerDataReference(triggerData, value.field)
  if (!reference.found) errors.push(`${path}.field "${value.field}" does not resolve in customVarsJson.`)
}

function validateCustomVariables(value: unknown, triggerData: unknown, path: string, errors: string[]): void {
  if (!requireArray(value, path, errors)) return
  const hasTriggerData = isRecord(triggerData) && Object.keys(triggerData).length > 0
  if (value.length > 0 && !hasTriggerData) {
    errors.push(`${path.replace(/\.customVars$/, '.customVarsJson')} is required when customVars contains variables.`)
  }
  const references = new Set<string>()
  value.forEach((variable, index) => {
    const variablePath = `${path}[${index}]`
    if (!requireRecord(variable, variablePath, errors)) return
    unknownProperties(variable, new Set(['name', 'reference', 'fieldType']), variablePath, errors)
    requiredString(variable.name, `${variablePath}.name`, errors)
    if (requiredString(variable.reference, `${variablePath}.reference`, errors)) {
      if (variable.reference.length > WORKFLOW_REFERENCE_MAX_LENGTH) {
        errors.push(`${variablePath}.reference must be at most ${WORKFLOW_REFERENCE_MAX_LENGTH.toLocaleString('en-US')} characters.`)
      } else {
        if (containsWhitespace(variable.reference)) errors.push(`${variablePath}.reference must not contain whitespace.`)
        if (references.has(variable.reference)) {
          errors.push(`${variablePath}.reference duplicates "${variable.reference}".`)
        }
        references.add(variable.reference)
      }
    }
    if (requiredString(variable.fieldType, `${variablePath}.fieldType`, errors) && !CUSTOM_VARIABLE_TYPES.has(variable.fieldType)) {
      errors.push(`${variablePath}.fieldType is not supported.`)
    }
    if (
      !hasTriggerData ||
      typeof variable.reference !== 'string' ||
      !variable.reference ||
      variable.reference.length > WORKFLOW_REFERENCE_MAX_LENGTH
    ) return
    const resolved = triggerDataReference(triggerData, variable.reference)
    if (!resolved.found) {
      errors.push(`${variablePath}.reference "${variable.reference}" does not resolve in customVarsJson.`)
    } else if (!resolved.type) {
      errors.push(`${variablePath}.reference "${variable.reference}" must select a primitive value or a non-empty array.`)
    } else if (
      typeof variable.fieldType === 'string' &&
      variable.fieldType !== resolved.type &&
      !(variable.fieldType === 'date' && resolved.type === 'string')
    ) {
      errors.push(
        `${variablePath}.fieldType must be "${resolved.type}" for trigger-data reference "${variable.reference}".`
      )
    }
  })
}

function validateInfo(value: unknown, path: string, errors: string[], whiteLabel: boolean): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(value, new Set(['name', 'description', 'summary', 'groupName', 'keywords', 'icon', 'screenshots']), path, errors)
  requiredString(value.name, `${path}.name`, errors)
  for (const field of ['description', 'summary', 'groupName', 'icon']) {
    optionalString(value[field], `${path}.${field}`, errors)
  }
  if (typeof value.description === 'string' && value.description.length > 200) {
    errors.push(`${path}.description must be at most 200 characters.`)
  }
  if (typeof value.summary === 'string' && value.summary.length > 500) {
    errors.push(`${path}.summary must be at most 500 characters.`)
  }
  if (whiteLabel) {
    for (const field of ['name', 'description', 'summary']) {
      if (typeof value[field] !== 'string' || !value[field]) continue
      const result = validateTextForWhiteLabel(value[field], `${path}.${field}`)
      if (result !== true) errors.push(result)
    }
  }
  if (value.keywords !== undefined) stringArray(value.keywords, `${path}.keywords`, errors)
  if (value.screenshots !== undefined && requireArray(value.screenshots, `${path}.screenshots`, errors)) {
    value.screenshots.forEach((screenshot, index) => {
      validatePublicUrl(screenshot, `${path}.screenshots[${index}]`, errors, 'https', true)
    })
  }
}

function validateSubscription(
  value: unknown,
  path: string,
  errors: string[],
  publishable: boolean
): void {
  if (value === undefined) {
    if (publishable) errors.push(`${path}.url is required before submission for review.`)
    return
  }
  if (!requireRecord(value, path, errors)) return
  unknownProperties(value, new Set(['url', 'headers']), path, errors)
  if (publishable && (typeof value.url !== 'string' || !value.url.trim())) {
    errors.push(`${path}.url is required before submission for review.`)
  }
  validatePublicUrl(value.url, `${path}.url`, errors, 'http', publishable)
  if (value.headers !== undefined) {
    validateHeaders(value.headers, `${path}.headers`, errors)
    if (isRecord(value.headers) && Object.keys(value.headers).length > 0 && !value.url) {
      errors.push(`${path}.url is required when subscription headers are configured.`)
    }
  }
}

function rejectRemoteSecretReferences(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectRemoteSecretReferences(item, `${path}[${index}]`, errors))
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (key === 'headers' && isRecord(child)) {
      for (const [header, headerValue] of Object.entries(child)) {
        if (headerValue === WORKFLOW_REMOTE_REFERENCE) {
          errors.push(`${childPath}.${header} cannot use "${WORKFLOW_REMOTE_REFERENCE}" on a new local trigger.`)
        }
      }
    } else if (key !== 'customVarsJson') {
      rejectRemoteSecretReferences(child, childPath, errors)
    }
  }
}

function isPublishTarget(
  version: Record<string, unknown>,
  trigger: WorkflowTriggerDefinition,
  options: WorkflowTriggerValidationOptions
): boolean {
  if (!options.publishable) return false
  if (options.triggerKey && trigger.key !== options.triggerKey) return false
  if (options.version && version.version !== options.version) return false
  return version.status === 'draft'
}

function validateVersion(
  value: unknown,
  path: string,
  trigger: WorkflowTriggerDefinition,
  options: WorkflowTriggerValidationOptions,
  errors: string[]
): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(
    value,
    new Set(['version', 'status', 'info', 'filters', 'customVars', 'customVarsJson', 'subscriptionConfig']),
    path,
    errors
  )
  if (requiredString(value.version, `${path}.version`, errors)) {
    if (value.version.length > WORKFLOW_VERSION_MAX_LENGTH) {
      errors.push(`${path}.version must be at most ${WORKFLOW_VERSION_MAX_LENGTH} characters.`)
    } else if (!isWorkflowVersion(value.version)) {
      errors.push(`${path}.version must use trigger version format x.y, for example "1.0".`)
    }
  }
  if (requiredString(value.status, `${path}.status`, errors) && !STATUSES.has(value.status)) {
    errors.push(`${path}.status must be draft, in_review, or published.`)
  }
  validateInfo(value.info, `${path}.info`, errors, options.whiteLabel === true)
  if (value.customVarsJson !== undefined && !isRecord(value.customVarsJson)) {
    errors.push(`${path}.customVarsJson must be an object.`)
  }
  if (value.filters !== undefined && requireArray(value.filters, `${path}.filters`, errors)) {
    const fields = new Set<string>()
    value.filters.forEach((filter, index) => {
      validateFilter(filter, value.customVarsJson, `${path}.filters[${index}]`, fields, errors)
    })
    const dynamicCount = value.filters.filter(filter => isRecord(filter) && filter.fieldType === 'DYNAMIC').length
    if (dynamicCount > 1) errors.push(`${path}.filters may contain at most one DYNAMIC filter.`)
  }
  if (value.customVars !== undefined) {
    validateCustomVariables(value.customVars, value.customVarsJson, `${path}.customVars`, errors)
  }
  validateSubscription(
    value.subscriptionConfig,
    `${path}.subscriptionConfig`,
    errors,
    isPublishTarget(value, trigger, options)
  )
}

function validateTrigger(
  value: unknown,
  path: string,
  keys: Set<string>,
  templates: Set<string>,
  options: WorkflowTriggerValidationOptions,
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
    if (keys.has(lower)) errors.push(`${path}.key duplicates trigger key "${value.key}".`)
    keys.add(lower)
  }
  if (!requireArray(value.versions, `${path}.versions`, errors)) return
  if (value.versions.length === 0) errors.push(`${path}.versions must contain at least one version.`)
  const versions = new Set<string>()
  let draftCount = 0
  value.versions.forEach((version, index) => {
    if (isRecord(version)) {
      if (typeof version.version === 'string') {
        if (versions.has(version.version)) errors.push(`${path}.versions[${index}].version duplicates "${version.version}".`)
        versions.add(version.version)
      }
      if (version.status === 'draft') draftCount += 1
    }
    validateVersion(version, `${path}.versions[${index}]`, value as unknown as WorkflowTriggerDefinition, options, errors)
  })
  if (draftCount > 1) errors.push(`${path}.versions may contain only one draft version.`)
  if (!value.templateId) {
    const onlyVersion = value.versions[0]
    if (
      value.versions.length !== 1 ||
      !isRecord(onlyVersion) ||
      onlyVersion.version !== '1.0' ||
      onlyVersion.status !== 'draft'
    ) {
      errors.push(`${path} without a templateId must contain only a local draft at version 1.0.`)
    }
    rejectRemoteSecretReferences(value, path, errors)
  }
}

export function validateWorkflowTriggersManifest(
  value: unknown,
  options: WorkflowTriggerValidationOptions = {}
): string[] {
  const errors: string[] = []
  const path = 'workflow-triggers.json'
  if (!requireRecord(value, path, errors)) return errors
  unknownProperties(value, new Set(['schemaVersion', 'appId', 'triggers']), path, errors)
  if (value.schemaVersion !== 1) errors.push(`${path}.schemaVersion must be 1.`)
  requiredString(value.appId, `${path}.appId`, errors)
  if (!requireArray(value.triggers, `${path}.triggers`, errors)) return errors
  if (value.triggers.length > 20) errors.push(`${path}.triggers supports at most 20 triggers per app.`)
  const keys = new Set<string>()
  const templates = new Set<string>()
  value.triggers.forEach((trigger, index) => {
    validateTrigger(trigger, `${path}.triggers[${index}]`, keys, templates, options, errors)
  })
  if (options.publishable) {
    const triggers = value.triggers.filter(isRecord)
    const target = options.triggerKey
      ? triggers.find(trigger => trigger.key === options.triggerKey)
      : undefined
    if (options.triggerKey && !target) {
      errors.push(`${path} trigger "${options.triggerKey}" was not found.`)
    } else if (target) {
      const versions = Array.isArray(target.versions) ? target.versions.filter(isRecord) : []
      const version = options.version
        ? versions.find(candidate => candidate.version === options.version)
        : versions.find(candidate => candidate.status === 'draft')
      if (!version) {
        const suffix = options.version ? ` version ${options.version}` : ''
        errors.push(`${path} trigger "${options.triggerKey}"${suffix} was not found as an editable draft.`)
      } else if (version.status !== 'draft') {
        errors.push(`${path} trigger "${options.triggerKey}" version ${version.version} is not an editable draft.`)
      }
    } else if (!triggers.some(trigger =>
      Array.isArray(trigger.versions) && trigger.versions.some(version => isRecord(version) && version.status === 'draft')
    )) {
      errors.push(`${path} contains no draft workflow trigger to validate for publication.`)
    }
  }
  return errors
}

export function validateWorkflowTriggerVersionForPublish(
  manifest: WorkflowTriggersManifest,
  triggerKey: string,
  version: string
): string[] {
  return validateWorkflowTriggersManifest(manifest, { publishable: true, triggerKey, version })
}

export function isWorkflowTriggersManifest(value: unknown): value is WorkflowTriggersManifest {
  return validateWorkflowTriggersManifest(value).length === 0
}

export function draftTriggerVersion(trigger: WorkflowTriggerDefinition): WorkflowTriggerVersion | undefined {
  return trigger.versions.find(version => version.status === 'draft')
}
