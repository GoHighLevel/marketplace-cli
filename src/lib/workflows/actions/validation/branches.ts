import { isRecord } from '../../../api/response.js'
import {
  optionalBoolean,
  optionalString,
  propertyPath,
  requireArray,
  requireRecord,
  requiredString,
  unknownProperties
} from '../../shared/schema-primitives.js'
import { WORKFLOW_REFERENCE_MAX_LENGTH, containsWhitespace } from '../../shared/value-validation.js'
import { validateFunctionExpression } from './code.js'
import { validateBranchFetchOptions, validateOptions } from './sources.js'

const BRANCH_FIELD_TYPES = new Set([
  'dynamic',
  'multiselect',
  'numerical',
  'phone',
  'select',
  'string',
  'textarea',
  'toggle'
])

function validateBranchField(
  value: unknown,
  path: string,
  seen: Set<string>,
  errors: string[]
): Record<string, unknown> | undefined {
  if (!requireRecord(value, path, errors)) return undefined
  unknownProperties(
    value,
    new Set([
      'field',
      'title',
      'required',
      'fieldType',
      'options',
      'mappedTo',
      'altersDynamicField',
      'disabled',
      'placeholder',
      'helpText',
      'value',
      'sortOptions'
    ]),
    path,
    errors
  )
  if (requiredString(value.field, `${path}.field`, errors)) {
    if (value.field.length > WORKFLOW_REFERENCE_MAX_LENGTH) {
      errors.push(`${path}.field must be at most ${WORKFLOW_REFERENCE_MAX_LENGTH.toLocaleString('en-US')} characters.`)
    } else {
      if (containsWhitespace(value.field)) errors.push(`${path}.field must not contain whitespace.`)
      if (seen.has(value.field)) errors.push(`${path}.field duplicates branch field "${value.field}".`)
      seen.add(value.field)
    }
  }
  requiredString(value.title, `${path}.title`, errors)
  if (requiredString(value.fieldType, `${path}.fieldType`, errors) && !BRANCH_FIELD_TYPES.has(value.fieldType)) {
    errors.push(`${path}.fieldType is not supported.`)
  }
  for (const field of ['required', 'altersDynamicField', 'disabled', 'sortOptions']) {
    optionalBoolean(value[field], `${path}.${field}`, errors)
  }
  for (const field of ['mappedTo', 'placeholder', 'helpText', 'value'])
    optionalString(value[field], `${path}.${field}`, errors)
  if (value.options !== undefined) validateOptions(value.options, `${path}.options`, errors)
  if (
    ['select', 'multiselect'].includes(String(value.fieldType)) &&
    (!Array.isArray(value.options) || value.options.length === 0)
  ) {
    errors.push(`${path}.options must contain at least one option for ${value.fieldType} branch fields.`)
  }
  return value
}

function branchValuePresent(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  return !Array.isArray(value) || value.length > 0
}

function branchOptionValues(field: Record<string, unknown>): string[] {
  if (!Array.isArray(field.options)) return []
  return field.options.flatMap(option => (isRecord(option) && typeof option.value === 'string' ? [option.value] : []))
}

function validateBranchValue(value: unknown, field: Record<string, unknown>, path: string, errors: string[]): void {
  const fieldType = field.fieldType
  if (['string', 'textarea', 'phone'].includes(String(fieldType))) {
    if (typeof value !== 'string') errors.push(`${path} must be a string for a ${fieldType} branch field.`)
    return
  }
  if (fieldType === 'numerical') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path} must be a finite number.`)
    return
  }
  if (fieldType === 'toggle') {
    if (typeof value !== 'boolean') errors.push(`${path} must be a boolean.`)
    return
  }
  const allowed = branchOptionValues(field)
  if (fieldType === 'select') {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      errors.push(`${path} must be one of: ${allowed.join(', ')}.`)
    }
    return
  }
  if (fieldType === 'multiselect') {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array.`)
      return
    }
    value.forEach((item, index) => {
      if (typeof item !== 'string' || !allowed.includes(item)) {
        errors.push(`${path}[${index}] must be one of: ${allowed.join(', ')}.`)
      }
    })
  }
}

function validatePredefinedBranchFields(
  value: Record<string, unknown>,
  branchFields: Map<string, Record<string, unknown>>,
  path: string,
  errors: string[]
): void {
  const fieldsPath = `${path}.fields`
  if (value.fields === undefined) return
  if (!isRecord(value.fields)) {
    errors.push(`${fieldsPath} must be an object.`)
    return
  }
  for (const fieldName of Object.keys(value.fields)) {
    if (!branchFields.has(fieldName)) {
      errors.push(`${propertyPath(fieldsPath, fieldName)} does not match a configured branch field.`)
    }
  }
  for (const [fieldName, field] of branchFields) {
    const fieldPath = propertyPath(fieldsPath, fieldName)
    const fieldValue = value.fields[fieldName]
    if (!branchValuePresent(fieldValue)) continue
    validateBranchValue(fieldValue, field, fieldPath, errors)
  }
}

export function validateBranches(value: unknown, path: string, errors: string[]): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(
    value,
    new Set(['allowMultipath', 'altersDynamicField', 'info', 'fields', 'predefinedBranches', 'branchFieldsGenerator']),
    path,
    errors
  )
  optionalBoolean(value.allowMultipath, `${path}.allowMultipath`, errors)
  optionalBoolean(value.altersDynamicField, `${path}.altersDynamicField`, errors)
  if (value.branchFieldsGenerator !== undefined) {
    if (typeof value.branchFieldsGenerator !== 'string' || !value.branchFieldsGenerator.trim()) {
      errors.push(`${path}.branchFieldsGenerator must be a non-empty function string.`)
    } else {
      validateFunctionExpression(value.branchFieldsGenerator, `${path}.branchFieldsGenerator`, errors)
    }
  }
  if (value.info !== undefined) {
    const infoPath = `${path}.info`
    if (requireRecord(value.info, infoPath, errors)) {
      const allowed = new Set([
        'branchNameLabel',
        'branchNameHelpText',
        'branchNamePlaceholder',
        'sectionTitle',
        'sectionDescription',
        'deleteAlertTitle',
        'deleteAlertDescription',
        'addButtonLabel',
        'allowNewCondition',
        'isDefaultBranchEditable',
        'showBranchSection'
      ])
      unknownProperties(value.info, allowed, infoPath, errors)
      for (const field of allowed) {
        if (['allowNewCondition', 'isDefaultBranchEditable', 'showBranchSection'].includes(field))
          optionalBoolean(value.info[field], `${infoPath}.${field}`, errors)
        else optionalString(value.info[field], `${infoPath}.${field}`, errors)
      }
    }
  }
  const branchFields = new Map<string, Record<string, unknown>>()
  if (value.fields !== undefined && requireArray(value.fields, `${path}.fields`, errors)) {
    const seen = new Set<string>()
    value.fields.forEach((field, index) => {
      const validated = validateBranchField(field, `${path}.fields[${index}]`, seen, errors)
      if (validated && typeof validated.field === 'string' && !branchFields.has(validated.field)) {
        branchFields.set(validated.field, validated)
      }
    })
  }
  if (value.predefinedBranches !== undefined) {
    const predefinedPath = `${path}.predefinedBranches`
    if (requireRecord(value.predefinedBranches, predefinedPath, errors)) {
      unknownProperties(
        value.predefinedBranches,
        new Set(['branches', 'fetchBranches', 'customGenerator']),
        predefinedPath,
        errors
      )
      if (value.predefinedBranches.fetchBranches !== undefined) {
        validateBranchFetchOptions(value.predefinedBranches.fetchBranches, `${predefinedPath}.fetchBranches`, errors)
      }
      if (value.predefinedBranches.customGenerator !== undefined) {
        if (
          typeof value.predefinedBranches.customGenerator !== 'string' ||
          !value.predefinedBranches.customGenerator.trim()
        ) {
          errors.push(`${predefinedPath}.customGenerator must be a non-empty function string.`)
        } else {
          validateFunctionExpression(
            value.predefinedBranches.customGenerator,
            `${predefinedPath}.customGenerator`,
            errors
          )
        }
      }
      if (
        value.predefinedBranches.branches !== undefined &&
        requireArray(value.predefinedBranches.branches, `${predefinedPath}.branches`, errors)
      ) {
        const branchIds = new Set<string>()
        value.predefinedBranches.branches.forEach((branch, index) => {
          const branchPath = `${predefinedPath}.branches[${index}]`
          if (!requireRecord(branch, branchPath, errors)) return
          unknownProperties(
            branch,
            new Set(['branchName', 'fields', 'meta', 'conditionType', 'id']),
            branchPath,
            errors
          )
          requiredString(branch.branchName, `${branchPath}.branchName`, errors)
          if (requiredString(branch.id, `${branchPath}.id`, errors)) {
            if (branchIds.has(branch.id)) errors.push(`${branchPath}.id duplicates branch ID "${branch.id}".`)
            branchIds.add(branch.id)
          }
          if (
            requiredString(branch.conditionType, `${branchPath}.conditionType`, errors) &&
            !['default', 'user-defined'].includes(branch.conditionType)
          ) {
            errors.push(`${branchPath}.conditionType must be "default" or "user-defined".`)
          }
          if (branch.meta !== undefined && !isRecord(branch.meta)) {
            errors.push(`${branchPath}.meta must be an object.`)
          }
          validatePredefinedBranchFields(branch, branchFields, branchPath, errors)
        })
      }
    }
  }
}
