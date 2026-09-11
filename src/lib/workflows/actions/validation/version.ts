import { isRecord } from '../../../api/response.js'
import { validateTextForWhiteLabel } from '../../../shared/validation.js'
import {
  optionalString,
  propertyPath,
  requireArray,
  requireRecord,
  requiredString,
  stringArray,
  unknownProperties
} from '../../shared/schema-primitives.js'
import { WORKFLOW_VERSION_MAX_LENGTH, isWorkflowVersion } from '../../shared/value-validation.js'
import type { WorkflowActionDefinition } from '../manifest.js'
import { validateBranches } from './branches.js'
import { validateCustomVariables } from './custom-variables.js'
import { validateExecution } from './execution.js'
import { validateInput } from './inputs.js'
import { validatePublicHttpsUrl } from './sources.js'

export interface WorkflowActionValidationOptions {
  publishable?: boolean
  actionKey?: string
  version?: string
  whiteLabel?: boolean
}

const STATUSES = new Set(['draft', 'in_review', 'published'])

function validateSectionGrouping(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (value.sectionOrder !== undefined) {
    stringArray(value.sectionOrder, `${path}.sectionOrder`, errors)
    if (Array.isArray(value.sectionOrder)) {
      const order = value.sectionOrder.filter((item): item is string => typeof item === 'string')
      if (new Set(order).size !== order.length) errors.push(`${path}.sectionOrder must not contain duplicates.`)
    }
  }
  if (value.groupConfigs !== undefined && requireRecord(value.groupConfigs, `${path}.groupConfigs`, errors)) {
    for (const [group, config] of Object.entries(value.groupConfigs)) {
      const configPath = propertyPath(`${path}.groupConfigs`, group)
      if (!requireRecord(config, configPath, errors)) continue
      unknownProperties(config, new Set(['dividerPosition']), configPath, errors)
      if (
        config.dividerPosition !== undefined &&
        !['none', 'above', 'below'].includes(String(config.dividerPosition))
      ) {
        errors.push(`${configPath}.dividerPosition must be "none", "above", or "below".`)
      }
    }
  }
}

function validateInfo(value: unknown, path: string, errors: string[], whiteLabel: boolean): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(
    value,
    new Set(['name', 'description', 'summary', 'groupName', 'keywords', 'icon', 'screenshots']),
    path,
    errors
  )
  requiredString(value.name, `${path}.name`, errors)
  for (const field of ['description', 'summary', 'groupName', 'icon'])
    optionalString(value[field], `${path}.${field}`, errors)
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
      validatePublicHttpsUrl(screenshot, `${path}.screenshots[${index}]`, errors, true)
    })
  }
}

function isPublishTarget(
  version: Record<string, unknown>,
  action: WorkflowActionDefinition,
  options: WorkflowActionValidationOptions
): boolean {
  if (!options.publishable) return false
  if (options.actionKey && action.key !== options.actionKey) return false
  if (options.version && version.version !== options.version) return false
  return version.status === 'draft'
}

export function validateVersion(
  value: unknown,
  path: string,
  action: WorkflowActionDefinition,
  options: WorkflowActionValidationOptions,
  errors: string[]
): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(
    value,
    new Set([
      'version',
      'status',
      'info',
      'inputs',
      'customVars',
      'customVarsJson',
      'executionConfig',
      'payloadCustomizationType',
      'customizedPayload',
      'branchesConfig',
      'sectionOrder',
      'groupConfigs'
    ]),
    path,
    errors
  )
  if (requiredString(value.version, `${path}.version`, errors)) {
    if (value.version.length > WORKFLOW_VERSION_MAX_LENGTH) {
      errors.push(`${path}.version must be at most ${WORKFLOW_VERSION_MAX_LENGTH} characters.`)
    } else if (!isWorkflowVersion(value.version)) {
      errors.push(`${path}.version must use action version format x.y, for example "1.0".`)
    }
  }
  if (requiredString(value.status, `${path}.status`, errors) && !STATUSES.has(value.status)) {
    errors.push(`${path}.status must be draft, in_review, or published.`)
  }
  validateInfo(value.info, `${path}.info`, errors, options.whiteLabel === true)
  const publishable = isPublishTarget(value, action, options)
  const immutable = value.status === 'published' || value.status === 'in_review'
  if (value.inputs !== undefined) {
    if (requireArray(value.inputs, `${path}.inputs`, errors)) {
      const seen = new Set<string>()
      value.inputs.forEach((input, index) => validateInput(input, `${path}.inputs[${index}]`, seen, errors, !immutable))
      const dynamicCount = value.inputs.filter(input => isRecord(input) && input.fieldType === 'DYNAMIC').length
      if (dynamicCount > 1) errors.push(`${path}.inputs may contain at most one DYNAMIC field.`)
      if (publishable && value.inputs.length === 0) {
        errors.push(`${path}.inputs must contain at least one field before submission for review.`)
      }
    }
  } else if (publishable) {
    errors.push(`${path}.inputs must contain at least one field before submission for review.`)
  }
  if (value.customVars !== undefined) {
    validateCustomVariables(
      value.customVars,
      value.customVarsJson,
      `${path}.customVars`,
      `${path}.customVarsJson`,
      errors
    )
  }
  if (value.customVarsJson !== undefined && !isRecord(value.customVarsJson))
    errors.push(`${path}.customVarsJson must be an object.`)
  if (value.executionConfig !== undefined) {
    validateExecution(value.executionConfig, `${path}.executionConfig`, errors, publishable, !immutable)
  } else if (publishable) errors.push(`${path}.executionConfig is required before submission for review.`)
  if (
    value.payloadCustomizationType !== undefined &&
    !['custom', 'default'].includes(String(value.payloadCustomizationType))
  ) {
    errors.push(`${path}.payloadCustomizationType must be "custom" or "default".`)
  }
  if (value.customizedPayload !== undefined && !isRecord(value.customizedPayload))
    errors.push(`${path}.customizedPayload must be an object.`)
  if (
    value.payloadCustomizationType === 'custom' &&
    (!isRecord(value.customizedPayload) || Object.keys(value.customizedPayload).length === 0)
  ) {
    errors.push(`${path}.customizedPayload must not be empty when payloadCustomizationType is "custom".`)
  }
  if (
    value.payloadCustomizationType === 'default' &&
    isRecord(value.customizedPayload) &&
    Object.keys(value.customizedPayload).length > 0
  ) {
    errors.push(`${path}.customizedPayload must be empty when payloadCustomizationType is "default".`)
  }
  if (
    value.payloadCustomizationType === 'custom' &&
    isRecord(value.executionConfig) &&
    value.executionConfig.type !== 'API'
  ) {
    errors.push(`${path}.payloadCustomizationType can be "custom" only for API execution.`)
  }
  if (value.branchesConfig !== undefined) validateBranches(value.branchesConfig, `${path}.branchesConfig`, errors)
  validateSectionGrouping(value, path, errors)
}
