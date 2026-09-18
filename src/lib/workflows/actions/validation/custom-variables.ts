import { isRecord } from '../../../api/response.js'
import { requireArray, requireRecord, requiredString, unknownProperties } from '../../shared/schema-primitives.js'
import { WORKFLOW_REFERENCE_MAX_LENGTH, containsWhitespace } from '../../shared/value-validation.js'
import { validateFetchOptions, validateOptions } from './sources.js'

const CUSTOM_VARIABLE_TYPES = new Set(['array', 'boolean', 'date', 'numerical', 'string'])

function responseReferenceType(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? 'array' : undefined
  if (value === null || isRecord(value)) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? 'numerical' : undefined
  if (typeof value === 'string' || typeof value === 'boolean') return typeof value
  return undefined
}

function resolveResponseReference(
  responseData: Record<string, unknown>,
  reference: string
): { found: boolean; type?: string } {
  let current: unknown = responseData
  for (const segment of reference.split('.')) {
    if (!segment || !isRecord(current) || !Object.hasOwn(current, segment)) return { found: false }
    current = current[segment]
  }
  return { found: true, type: responseReferenceType(current) }
}

export function validateCustomVariables(
  value: unknown,
  responseData: unknown,
  path: string,
  responsePath: string,
  errors: string[]
): void {
  if (!requireArray(value, path, errors)) return
  const hasVariables = value.length > 0
  const hasResponseData = isRecord(responseData) && Object.keys(responseData).length > 0
  if (hasVariables && !hasResponseData) {
    errors.push(`${responsePath} is required when customVars contains variables.`)
  }
  const references = new Set<string>()
  value.forEach((variable, index) => {
    const variablePath = `${path}[${index}]`
    if (!requireRecord(variable, variablePath, errors)) return
    unknownProperties(
      variable,
      new Set(['name', 'reference', 'fieldType', 'options', 'fetchOptions']),
      variablePath,
      errors
    )
    requiredString(variable.name, `${variablePath}.name`, errors)
    if (requiredString(variable.reference, `${variablePath}.reference`, errors)) {
      if (variable.reference.length > WORKFLOW_REFERENCE_MAX_LENGTH) {
        errors.push(
          `${variablePath}.reference must be at most ${WORKFLOW_REFERENCE_MAX_LENGTH.toLocaleString('en-US')} characters.`
        )
      } else {
        if (containsWhitespace(variable.reference)) {
          errors.push(`${variablePath}.reference must not contain whitespace.`)
        }
        if (references.has(variable.reference))
          errors.push(`${variablePath}.reference duplicates "${variable.reference}".`)
        references.add(variable.reference)
      }
    }
    if (
      requiredString(variable.fieldType, `${variablePath}.fieldType`, errors) &&
      !CUSTOM_VARIABLE_TYPES.has(variable.fieldType)
    ) {
      errors.push(`${variablePath}.fieldType is not supported.`)
    }
    if (variable.options !== undefined) validateOptions(variable.options, `${variablePath}.options`, errors)
    if (variable.fetchOptions !== undefined)
      validateFetchOptions(variable.fetchOptions, `${variablePath}.fetchOptions`, errors)
    if (
      !hasResponseData ||
      typeof variable.reference !== 'string' ||
      !variable.reference.trim() ||
      variable.reference.length > WORKFLOW_REFERENCE_MAX_LENGTH
    )
      return
    const resolved = resolveResponseReference(responseData, variable.reference)
    if (!resolved.found) return
    if (!resolved.type) {
      errors.push(
        `${variablePath}.reference "${variable.reference}" must select a primitive value or a non-empty array.`
      )
    } else if (
      typeof variable.fieldType === 'string' &&
      variable.fieldType !== resolved.type &&
      !(variable.fieldType === 'date' && resolved.type === 'string')
    ) {
      errors.push(
        `${variablePath}.fieldType must be "${resolved.type}" for response reference "${variable.reference}".`
      )
    }
  })
}
