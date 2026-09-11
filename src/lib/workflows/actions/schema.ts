import { RegExpValidator } from '@eslint-community/regexpp'
import { parse } from 'acorn'
import { isSafePattern } from 'redos-detector'

import { isRecord } from '../../api/response.js'
import { validateHttpUrl, validateHttpsUrl, validateTextForWhiteLabel } from '../../shared/validation.js'
import {
  isWorkflowActionSecretReference,
  workflowActionHeaderRequiresReference,
  WORKFLOW_ACTION_ENV_REFERENCE,
  WORKFLOW_ACTION_REMOTE_REFERENCE
} from './secrets.js'
import { workflowActionCodeSyntaxError, WORKFLOW_ACTION_CODE_MAX_BYTES } from './code.js'
import { workflowActionKeyValidationErrors } from './key.js'
import {
  type WorkflowActionDefinition,
  type WorkflowActionInput,
  type WorkflowActionsManifest,
  type WorkflowActionVersion
} from './manifest.js'
import { WORKFLOW_ACTION_FIELD_TYPES, WORKFLOW_ACTION_INTERNAL_REFERENCES } from './contract.js'
import {
  containsWhitespace,
  isWorkflowFieldKey,
  isWorkflowVersion,
  WORKFLOW_FIELD_KEY_MAX_LENGTH,
  WORKFLOW_REFERENCE_MAX_LENGTH,
  WORKFLOW_VERSION_MAX_LENGTH
} from '../shared/value-validation.js'

export interface WorkflowActionValidationOptions {
  publishable?: boolean
  actionKey?: string
  version?: string
  whiteLabel?: boolean
}

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const STATUSES = new Set(['draft', 'in_review', 'published'])
const METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
const FIELD_TYPES = new Set<string>(WORKFLOW_ACTION_FIELD_TYPES)
const INTERNAL_REFERENCES = new Set<string>(WORKFLOW_ACTION_INTERNAL_REFERENCES)
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
const CUSTOM_VARIABLE_TYPES = new Set(['array', 'boolean', 'date', 'numerical', 'string'])
const RICH_TEXT_EDITOR_TYPES = new Set(['html', 'plain-text'])
const VALIDATION_REGEX_MAX_CHARACTERS = 1_000
const REGEXP_VALIDATOR = new RegExpValidator({ ecmaVersion: 2022 })
const INPUT_PROPERTIES = new Set([
  'field',
  'title',
  'required',
  'fieldType',
  'helpText',
  'placeholder',
  'validations',
  'value',
  'options',
  'mappedTo',
  'fetchOptions',
  'hasDynamicOptions',
  'dynamicSource',
  'dynamicFieldsConfig',
  'altersDynamicField',
  'allowCustomInputPicker',
  'customInputHelperText',
  'eventListeners',
  'resetValue',
  'sortOptions',
  'order',
  'disabled',
  'dependentFilters',
  'showOperator',
  'useArrayToArrayComparison',
  'config',
  'showHelpTextAsInfoToolTip',
  'disableDatesFunction',
  'postProcessor',
  'showBelowCustomField',
  'fieldOptions',
  'timezoneSourceField',
  'hideAIToggle',
  'variant',
  'variantConfig',
  'group',
  'groupDivider',
  'translationKey'
])

function propertyPath(path: string, property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(property) ? `${path}.${property}` : `${path}[${JSON.stringify(property)}]`
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

function optionalInteger(value: unknown, path: string, errors: string[], range?: { min: number; max: number }): void {
  if (value === undefined) return
  if (!Number.isInteger(value)) {
    errors.push(`${path} must be an integer${range ? ` between ${range.min} and ${range.max}` : ''}.`)
    return
  }
  if (range && ((value as number) < range.min || (value as number) > range.max)) {
    errors.push(`${path} must be an integer between ${range.min} and ${range.max}.`)
  }
}

function optionalNonNegativeInteger(value: unknown, path: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    errors.push(`${path} must be a non-negative integer.`)
    return undefined
  }
  return value
}

function isValidFunctionExpression(value: string, arrowOnly = false): boolean {
  if (Buffer.byteLength(value, 'utf8') > WORKFLOW_ACTION_CODE_MAX_BYTES) return false
  try {
    const program = parse(`(${value})`, { ecmaVersion: 2022 })
    if (program.body.length !== 1 || program.body[0].type !== 'ExpressionStatement') return false
    const expression = program.body[0].expression
    return expression.type === 'ArrowFunctionExpression' || (!arrowOnly && expression.type === 'FunctionExpression')
  } catch {
    return false
  }
}

function validateFunctionExpression(value: string, path: string, errors: string[]): void {
  if (!isValidFunctionExpression(value)) errors.push(`${path} contains invalid function syntax.`)
}

function validateJavaScriptBlock(value: string, path: string, errors: string[]): void {
  const syntaxError = workflowActionCodeSyntaxError(value, path)
  if (syntaxError) errors.push(`${path} contains invalid JavaScript: ${syntaxError}.`)
}

function isSafeRegexPattern(value: string): boolean {
  try {
    return isSafePattern(value, {
      downgradePattern: false,
      maxScore: 1,
      maxSteps: 20_000
    }).safe
  } catch {
    return false
  }
}

function isPrintableAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) return false
  }
  return value.length > 0
}

function validateRegexRule(value: string, path: string, errors: string[]): void {
  if (value.length > VALIDATION_REGEX_MAX_CHARACTERS) {
    errors.push(`${path} must be at most ${VALIDATION_REGEX_MAX_CHARACTERS.toLocaleString('en-US')} characters.`)
    return
  }
  if (!isPrintableAscii(value)) {
    errors.push(`${path} may contain only printable ASCII characters.`)
    return
  }
  try {
    REGEXP_VALIDATOR.validatePattern(value)
  } catch {
    errors.push(`${path} must be a predefined validation, a valid regular expression, or an arrow function.`)
    return
  }
  if (!isSafeRegexPattern(value)) {
    errors.push(`${path} must not allow ambiguous backtracking.`)
  }
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
    if (looksLikeReference && !isWorkflowActionSecretReference(headerValue)) {
      errors.push(`${headerPath} must use "\${remote}" or "\${env:VARIABLE_NAME}" reference syntax.`)
    }
    if (
      workflowActionHeaderRequiresReference(name) &&
      headerValue !== WORKFLOW_ACTION_REMOTE_REFERENCE &&
      !WORKFLOW_ACTION_ENV_REFERENCE.test(headerValue)
    ) {
      errors.push(`${headerPath} is sensitive and must use an environment or remote-preservation reference.`)
    }
  }
}

function validateOptions(value: unknown, path: string, errors: string[]): void {
  if (!requireArray(value, path, errors)) return
  const optionValues = new Set<string>()
  value.forEach((option, index) => {
    const optionPath = `${path}[${index}]`
    if (!requireRecord(option, optionPath, errors)) return
    unknownProperties(
      option,
      new Set(['label', 'value', 'description', 'disabled', 'icon', 'iconUrl']),
      optionPath,
      errors
    )
    requiredString(option.label, `${optionPath}.label`, errors)
    if (requiredString(option.value, `${optionPath}.value`, errors)) {
      if (optionValues.has(option.value)) errors.push(`${optionPath}.value duplicates option value "${option.value}".`)
      optionValues.add(option.value)
    }
    optionalString(option.description, `${optionPath}.description`, errors)
    optionalString(option.icon, `${optionPath}.icon`, errors)
    optionalString(option.iconUrl, `${optionPath}.iconUrl`, errors)
    validatePublicHttpsUrl(option.iconUrl, `${optionPath}.iconUrl`, errors)
    optionalBoolean(option.disabled, `${optionPath}.disabled`, errors)
  })
}

function validatePublicHttpsUrl(value: unknown, path: string, errors: string[], required = false): void {
  if (value === undefined || value === '') {
    if (required) errors.push(`${path} is required.`)
    return
  }
  if (typeof value !== 'string') {
    errors.push(`${path} must be a string.`)
    return
  }
  const result = validateHttpsUrl(value, path, { publicOnly: true })
  if (result !== true) errors.push(result)
}

function validateFetchOptions(value: unknown, path: string, errors: string[]): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(
    value,
    new Set(['url', 'queryParams', 'headers', 'route', 'serviceName', 'version', 'source', 'sourceId', 'body']),
    path,
    errors
  )
  validatePublicHttpsUrl(value.url, `${path}.url`, errors)
  if (value.headers !== undefined) validateHeaders(value.headers, `${path}.headers`, errors)
  if (value.queryParams !== undefined && !isRecord(value.queryParams))
    errors.push(`${path}.queryParams must be an object.`)
  if (value.body !== undefined && !isRecord(value.body)) errors.push(`${path}.body must be an object.`)
  for (const field of ['route', 'serviceName', 'version', 'source', 'sourceId']) {
    optionalString(value[field], `${path}.${field}`, errors)
  }
  const hasUrl = typeof value.url === 'string' && Boolean(value.url.trim())
  const hasService = typeof value.serviceName === 'string' && Boolean(value.serviceName.trim())
  const hasRoute = typeof value.route === 'string' && Boolean(value.route.trim())
  if (hasService !== hasRoute) {
    errors.push(`${path}.serviceName and ${path}.route must be configured together.`)
  }
  if (Number(hasUrl) + Number(hasService && hasRoute) !== 1) {
    errors.push(`${path} must define exactly one source: url or serviceName with route.`)
  }
}

function validateBranchFetchOptions(value: unknown, path: string, errors: string[]): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(
    value,
    new Set(['serviceName', 'route', 'version', 'source', 'sourceId', 'body', 'headers']),
    path,
    errors
  )
  requiredString(value.serviceName, `${path}.serviceName`, errors)
  requiredString(value.route, `${path}.route`, errors)
  for (const field of ['version', 'source', 'sourceId']) {
    optionalString(value[field], `${path}.${field}`, errors)
  }
  if (value.body !== undefined && !isRecord(value.body)) errors.push(`${path}.body must be an object.`)
  if (value.headers !== undefined) validateHeaders(value.headers, `${path}.headers`, errors)
}

function validateDynamicFieldsConfig(value: unknown, path: string, errors: string[]): void {
  if (!requireRecord(value, path, errors)) return
  const allowed = new Set([
    'url',
    'headers',
    'route',
    'serviceName',
    'customGenerator',
    'method',
    'labelField',
    'valueField',
    'path',
    'dependsOn',
    'postProcessor',
    'queryParams',
    'version',
    'source',
    'sourceId',
    'body'
  ])
  unknownProperties(value, allowed, path, errors)
  validatePublicHttpsUrl(value.url, `${path}.url`, errors)
  if (value.headers !== undefined) validateHeaders(value.headers, `${path}.headers`, errors)
  for (const field of [
    'route',
    'serviceName',
    'customGenerator',
    'labelField',
    'valueField',
    'path',
    'postProcessor',
    'version',
    'source',
    'sourceId'
  ]) {
    optionalString(value[field], `${path}.${field}`, errors)
  }
  if (value.queryParams !== undefined && !isRecord(value.queryParams))
    errors.push(`${path}.queryParams must be an object.`)
  if (value.body !== undefined && !isRecord(value.body)) errors.push(`${path}.body must be an object.`)
  if (value.method !== undefined && !METHODS.has(String(value.method))) {
    errors.push(`${path}.method must be one of: ${[...METHODS].join(', ')}.`)
  }
  if (value.dependsOn !== undefined) stringArray(value.dependsOn, `${path}.dependsOn`, errors)
  if (typeof value.customGenerator === 'string' && value.customGenerator.trim()) {
    validateFunctionExpression(value.customGenerator, `${path}.customGenerator`, errors)
  }

  const hasUrl = typeof value.url === 'string' && Boolean(value.url.trim())
  const hasGenerator = typeof value.customGenerator === 'string' && Boolean(value.customGenerator.trim())
  const hasService = typeof value.serviceName === 'string' && Boolean(value.serviceName.trim())
  const hasRoute = typeof value.route === 'string' && Boolean(value.route.trim())
  if (hasService !== hasRoute) {
    errors.push(`${path}.serviceName and ${path}.route must be configured together.`)
  }
  const sourceCount = Number(hasUrl) + Number(hasGenerator) + Number(hasService && hasRoute)
  if (sourceCount !== 1) {
    errors.push(`${path} must define exactly one source: url, customGenerator, or serviceName with route.`)
  }
}

function validatePagination(value: unknown, path: string, errors: string[]): void {
  if (!requireRecord(value, path, errors)) return
  const stringFields = [
    'strategy',
    'pageParam',
    'perPageParam',
    'limitParam',
    'offsetParam',
    'cursorParam',
    'nextCursorField',
    'syncTokenField',
    'syncTokenParam',
    'searchParam'
  ]
  const allowed = new Set([
    ...stringFields,
    'enabled',
    'perPageValue',
    'startingPage',
    'limitValue',
    'supportsSearch',
    'fetchAllPages',
    'order',
    'searchDetail',
    'singleDetail'
  ])
  unknownProperties(value, allowed, path, errors)
  stringFields.forEach(field => optionalString(value[field], `${path}.${field}`, errors))
  for (const field of ['perPageValue', 'startingPage', 'limitValue']) {
    optionalNonNegativeInteger(value[field], `${path}.${field}`, errors)
  }
  optionalBoolean(value.enabled, `${path}.enabled`, errors)
  optionalBoolean(value.supportsSearch, `${path}.supportsSearch`, errors)
  optionalBoolean(value.fetchAllPages, `${path}.fetchAllPages`, errors)
  if (
    value.strategy !== undefined &&
    !['limit_offset', 'page', 'last_page', 'cursor', 'next_url'].includes(String(value.strategy))
  ) {
    errors.push(`${path}.strategy must be limit_offset, page, last_page, cursor, or next_url.`)
  }
  if (value.order !== undefined && !['asc', 'desc'].includes(String(value.order))) {
    errors.push(`${path}.order must be "asc" or "desc".`)
  }
  for (const field of ['searchDetail', 'singleDetail']) {
    if (value[field] !== undefined) validateDynamicSource(value[field], `${path}.${field}`, errors, false)
  }
}

function validateDynamicSource(value: unknown, path: string, errors: string[], allowPagination = true): void {
  if (!requireRecord(value, path, errors)) return
  const allowed = new Set([
    'executionType',
    'code',
    'url',
    'method',
    'headers',
    'labelField',
    'valueField',
    'path',
    'body',
    'postProcessor',
    ...(allowPagination ? ['pagination'] : [])
  ])
  unknownProperties(value, allowed, path, errors)
  const executionType = value.executionType ?? 'API'
  if (!['API', 'CODE'].includes(String(executionType))) {
    errors.push(`${path}.executionType must be "API" or "CODE".`)
  }
  if (executionType === 'CODE') {
    if (typeof value.code !== 'string' || !value.code.trim()) {
      errors.push(`${path}.code is required when executionType is "CODE".`)
    } else {
      validateJavaScriptBlock(value.code, `${path}.code`, errors)
    }
    for (const field of ['url', 'method', 'headers', 'labelField', 'valueField', 'path', 'body', 'postProcessor']) {
      if (value[field] !== undefined) errors.push(`${path}.${field} is only supported when executionType is "API".`)
    }
  } else {
    validatePublicHttpsUrl(value.url, `${path}.url`, errors, true)
    if (value.code !== undefined) errors.push(`${path}.code is only supported when executionType is "CODE".`)
  }
  if (value.method !== undefined && !METHODS.has(String(value.method))) {
    errors.push(`${path}.method must be one of: ${[...METHODS].join(', ')}.`)
  }
  if (value.headers !== undefined) validateHeaders(value.headers, `${path}.headers`, errors)
  for (const field of ['labelField', 'valueField', 'path', 'postProcessor']) {
    optionalString(value[field], `${path}.${field}`, errors)
  }
  if (value.body !== undefined && !isRecord(value.body)) errors.push(`${path}.body must be an object.`)
  if (allowPagination && value.pagination !== undefined)
    validatePagination(value.pagination, `${path}.pagination`, errors)
}

function validateInputPresentation(input: Record<string, unknown>, path: string, errors: string[]): void {
  if (input.config !== undefined && requireRecord(input.config, `${path}.config`, errors)) {
    const configPath = `${path}.config`
    if (input.fieldType === 'key-value') {
      unknownProperties(input.config, new Set(['maxItems', 'lockDefaultKeys', 'addItemLabel']), configPath, errors)
      optionalNonNegativeInteger(input.config.maxItems, `${configPath}.maxItems`, errors)
      optionalBoolean(input.config.lockDefaultKeys, `${configPath}.lockDefaultKeys`, errors)
      optionalString(input.config.addItemLabel, `${configPath}.addItemLabel`, errors)
    } else if (input.fieldType === 'fieldSet') {
      unknownProperties(
        input.config,
        new Set(['innerFields', 'addItemLabel', 'itemLabel', 'minSets', 'maxSets']),
        configPath,
        errors
      )
      if (input.config.innerFields === undefined)
        errors.push(`${configPath}.innerFields is required for a fieldSet input.`)
      else stringArray(input.config.innerFields, `${configPath}.innerFields`, errors)
      optionalString(input.config.addItemLabel, `${configPath}.addItemLabel`, errors)
      optionalString(input.config.itemLabel, `${configPath}.itemLabel`, errors)
      const minSets = optionalNonNegativeInteger(input.config.minSets, `${configPath}.minSets`, errors)
      const maxSets = optionalNonNegativeInteger(input.config.maxSets, `${configPath}.maxSets`, errors)
      if (minSets !== undefined && maxSets !== undefined && minSets > maxSets) {
        errors.push(`${configPath}.minSets must not exceed maxSets.`)
      }
    } else {
      unknownProperties(input.config, new Set(['richTextEditorType']), configPath, errors)
      const richTextEditorType = input.config.richTextEditorType
      if (
        richTextEditorType !== undefined &&
        (typeof richTextEditorType !== 'string' || !RICH_TEXT_EDITOR_TYPES.has(richTextEditorType))
      ) {
        errors.push(`${configPath}.richTextEditorType must be "html" or "plain-text".`)
      }
    }
  }
  if (input.fieldOptions !== undefined && requireRecord(input.fieldOptions, `${path}.fieldOptions`, errors)) {
    const optionsPath = `${path}.fieldOptions`
    unknownProperties(
      input.fieldOptions,
      new Set(['allowedFileTypes', 'showTextFiles', 'showUrlFiles', 'isClearable']),
      optionsPath,
      errors
    )
    if (input.fieldOptions.allowedFileTypes !== undefined)
      stringArray(input.fieldOptions.allowedFileTypes, `${optionsPath}.allowedFileTypes`, errors)
    for (const field of ['showTextFiles', 'showUrlFiles', 'isClearable']) {
      optionalBoolean(input.fieldOptions[field], `${optionsPath}.${field}`, errors)
    }
  }
  if (input.variantConfig !== undefined && requireRecord(input.variantConfig, `${path}.variantConfig`, errors)) {
    const configPath = `${path}.variantConfig`
    unknownProperties(
      input.variantConfig,
      new Set(['columns', 'allowDeselect', 'tileSize', 'showDescription']),
      configPath,
      errors
    )
    optionalInteger(input.variantConfig.columns, `${configPath}.columns`, errors, { min: 2, max: 5 })
    optionalBoolean(input.variantConfig.allowDeselect, `${configPath}.allowDeselect`, errors)
    optionalBoolean(input.variantConfig.showDescription, `${configPath}.showDescription`, errors)
    if (
      input.variantConfig.tileSize !== undefined &&
      !['sm', 'md', 'lg'].includes(String(input.variantConfig.tileSize))
    ) {
      errors.push(`${configPath}.tileSize must be "sm", "md", or "lg".`)
    }
  }
}

function validateRules(value: unknown, path: string, errors: string[]): void {
  if (!requireArray(value, path, errors)) return
  const predefined = new Set(['isValidEmail', 'isValidHandleBar', 'isValidNumeric', 'isValidPhone', 'isValidURL'])
  value.forEach((rule, index) => {
    const rulePath = `${path}[${index}]`
    if (!requireRecord(rule, rulePath, errors)) return
    unknownProperties(rule, new Set(['rule', 'errorMessage']), rulePath, errors)
    if (requiredString(rule.rule, `${rulePath}.rule`, errors) && !predefined.has(rule.rule)) {
      if (rule.rule.includes('=>')) {
        if (!isValidFunctionExpression(rule.rule, true)) {
          errors.push(`${rulePath}.rule contains invalid arrow-function syntax.`)
        }
      } else {
        validateRegexRule(rule.rule, `${rulePath}.rule`, errors)
      }
    }
    requiredString(rule.errorMessage, `${rulePath}.errorMessage`, errors)
  })
}

function validateInput(
  input: unknown,
  path: string,
  seen: Set<string>,
  errors: string[],
  validateUniqueField: boolean
): void {
  if (!requireRecord(input, path, errors)) return
  unknownProperties(input, INPUT_PROPERTIES, path, errors)
  if (requiredString(input.field, `${path}.field`, errors)) {
    if (input.field.length > WORKFLOW_FIELD_KEY_MAX_LENGTH) {
      errors.push(`${path}.field must be at most ${WORKFLOW_FIELD_KEY_MAX_LENGTH} characters.`)
    } else {
      if (!isWorkflowFieldKey(input.field) && input.field !== 'DYNAMIC') {
        errors.push(`${path}.field must start with a letter and contain only letters, numbers, and underscores.`)
      }
      if (validateUniqueField && seen.has(input.field)) {
        errors.push(`${path}.field duplicates input field "${input.field}".`)
      }
      seen.add(input.field)
    }
  }
  requiredString(input.title, `${path}.title`, errors)
  if (!requiredString(input.fieldType, `${path}.fieldType`, errors) || !FIELD_TYPES.has(input.fieldType)) {
    if (typeof input.fieldType === 'string') errors.push(`${path}.fieldType is not supported.`)
  }
  optionalBoolean(input.required, `${path}.required`, errors)
  for (const field of [
    'helpText',
    'placeholder',
    'mappedTo',
    'customInputHelperText',
    'postProcessor',
    'timezoneSourceField',
    'group',
    'translationKey'
  ]) {
    optionalString(input[field], `${path}.${field}`, errors)
  }
  if (typeof input.mappedTo === 'string' && input.mappedTo && !INTERNAL_REFERENCES.has(input.mappedTo)) {
    errors.push(`${path}.mappedTo must be one of: ${WORKFLOW_ACTION_INTERNAL_REFERENCES.join(', ')}.`)
  }
  for (const field of [
    'altersDynamicField',
    'allowCustomInputPicker',
    'hasDynamicOptions',
    'resetValue',
    'sortOptions',
    'disabled',
    'showOperator',
    'useArrayToArrayComparison',
    'showBelowCustomField',
    'hideAIToggle',
    'groupDivider',
    'showHelpTextAsInfoToolTip'
  ]) {
    optionalBoolean(input[field], `${path}.${field}`, errors)
  }
  optionalNonNegativeInteger(input.order, `${path}.order`, errors)
  if (input.disableDatesFunction !== undefined) {
    if (typeof input.disableDatesFunction !== 'string' || !input.disableDatesFunction.trim()) {
      errors.push(`${path}.disableDatesFunction must be a non-empty function string.`)
    } else {
      validateFunctionExpression(input.disableDatesFunction, `${path}.disableDatesFunction`, errors)
    }
  }
  for (const field of ['eventListeners', 'dependentFilters']) {
    if (input[field] !== undefined) stringArray(input[field], `${path}.${field}`, errors)
  }
  if (input.options !== undefined) validateOptions(input.options, `${path}.options`, errors)
  if (input.validations !== undefined) validateRules(input.validations, `${path}.validations`, errors)
  if (input.fetchOptions !== undefined) validateFetchOptions(input.fetchOptions, `${path}.fetchOptions`, errors)
  if (input.dynamicSource !== undefined) validateDynamicSource(input.dynamicSource, `${path}.dynamicSource`, errors)
  if (input.dynamicFieldsConfig !== undefined)
    validateDynamicFieldsConfig(input.dynamicFieldsConfig, `${path}.dynamicFieldsConfig`, errors)
  if (input.value !== undefined) {
    if (['attachment', 'DYNAMIC'].includes(String(input.fieldType))) {
      errors.push(`${path}.value is not supported for ${input.fieldType} inputs.`)
    } else {
      optionalString(input.value, `${path}.value`, errors)
    }
  }
  if (input.validations !== undefined && ['DYNAMIC', 'custom-html'].includes(String(input.fieldType))) {
    errors.push(`${path}.validations are not supported for ${input.fieldType} inputs.`)
  }
  const selectTypes = ['select', 'multiselect', 'radio']
  const dynamicSourceTypes = [...selectTypes, 'select_with_pagination', 'multiselect_with_pagination']
  if (!selectTypes.includes(String(input.fieldType))) {
    for (const property of ['options', 'mappedTo', 'fetchOptions']) {
      if (input[property] !== undefined) {
        errors.push(`${path}.${property} is supported only for select, multiselect, or radio inputs.`)
      }
    }
  }
  if (input.fieldType === 'radio' && input.mappedTo !== undefined) {
    errors.push(`${path}.mappedTo is not supported for radio inputs.`)
  }
  if (input.dynamicSource !== undefined && !dynamicSourceTypes.includes(String(input.fieldType))) {
    errors.push(`${path}.dynamicSource is supported only for select inputs.`)
  }
  if (input.dynamicFieldsConfig !== undefined && input.fieldType !== 'DYNAMIC') {
    errors.push(`${path}.dynamicFieldsConfig is supported only for DYNAMIC inputs.`)
  }
  validateInputPresentation(input, path, errors)
  if (input.variant !== undefined && !['standard', 'tile-picker'].includes(String(input.variant))) {
    errors.push(`${path}.variant must be "standard" or "tile-picker".`)
  }
  if (input.variant === 'tile-picker' && !['select', 'multiselect', 'radio'].includes(String(input.fieldType))) {
    errors.push(`${path}.variant "tile-picker" is supported only for select, multiselect, and radio fields.`)
  }
  if (input.variantConfig !== undefined && input.variant !== 'tile-picker') {
    errors.push(`${path}.variantConfig requires variant "tile-picker".`)
  }
  if (selectTypes.includes(String(input.fieldType))) {
    const optionSources = [
      input.options !== undefined ? 'options' : undefined,
      input.mappedTo !== undefined ? 'mappedTo' : undefined,
      input.fetchOptions !== undefined ? 'fetchOptions' : undefined,
      input.dynamicSource !== undefined ? 'dynamicSource' : undefined
    ].filter((source): source is string => source !== undefined)
    if (optionSources.length === 0) {
      errors.push(
        `${path} must define options, mappedTo, fetchOptions, or dynamicSource for ${input.fieldType} fields.`
      )
    } else if (optionSources.length > 1) {
      errors.push(`${path} must define exactly one option source; found ${optionSources.join(', ')}.`)
    }
    if (input.options !== undefined && (!Array.isArray(input.options) || input.options.length === 0)) {
      errors.push(`${path}.options must contain at least one option.`)
    }
  }
  if (
    ['select_with_pagination', 'multiselect_with_pagination'].includes(String(input.fieldType)) &&
    !isRecord(input.dynamicSource)
  ) {
    errors.push(`${path}.dynamicSource is required for paginated select fields.`)
  }
  if (input.fieldType === 'DYNAMIC') {
    if (input.field !== 'DYNAMIC') errors.push(`${path}.field must be "DYNAMIC" for a dynamic input.`)
    if (input.required === true) errors.push(`${path}.required must be false for a dynamic input.`)
    if (!isRecord(input.dynamicFieldsConfig)) {
      errors.push(`${path}.dynamicFieldsConfig is required for a dynamic input.`)
    }
  }
}

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

function validateCustomVariables(
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

function validateExecution(
  value: unknown,
  path: string,
  errors: string[],
  publishable: boolean,
  validateCodeSyntax: boolean
): void {
  if (!requireRecord(value, path, errors)) return
  unknownProperties(value, new Set(['type', 'url', 'method', 'headers', 'code', 'pauseExecution']), path, errors)
  const type = value.type
  if (type !== 'API' && type !== 'CODE') errors.push(`${path}.type must be "API" or "CODE".`)
  optionalBoolean(value.pauseExecution, `${path}.pauseExecution`, errors)
  if (type === 'API') {
    if (value.code !== undefined) errors.push(`${path}.code is only supported when type is "CODE".`)
    if (value.url !== undefined && typeof value.url !== 'string') errors.push(`${path}.url must be a string.`)
    if (typeof value.url === 'string' && value.url) {
      const result = validateHttpUrl(value.url, `${path}.url`, { publicOnly: true })
      if (result !== true) errors.push(result)
      if (value.method === undefined) errors.push(`${path}.method is required when an API URL is configured.`)
    } else if (publishable) {
      errors.push(`${path}.url is required before an API action can be submitted for review.`)
    }
    if (value.method !== undefined && !METHODS.has(String(value.method))) {
      errors.push(`${path}.method must be one of: ${[...METHODS].join(', ')}.`)
    }
    if (value.headers !== undefined) {
      validateHeaders(value.headers, `${path}.headers`, errors)
      if (isRecord(value.headers) && Object.keys(value.headers).length > 0 && !value.url) {
        errors.push(`${path}.url is required when API headers are configured.`)
      }
    }
  }
  if (type === 'CODE') {
    for (const field of ['url', 'method', 'headers']) {
      if (value[field] !== undefined) errors.push(`${path}.${field} is only supported when type is "API".`)
    }
    if (value.code !== undefined && typeof value.code !== 'string') errors.push(`${path}.code must be a string.`)
    if (typeof value.code === 'string' && value.code.trim()) {
      if (Buffer.byteLength(value.code, 'utf8') > WORKFLOW_ACTION_CODE_MAX_BYTES) {
        errors.push(`${path}.code must be at most 1 MiB.`)
      } else if (validateCodeSyntax) {
        validateJavaScriptBlock(value.code, `${path}.code`, errors)
      }
    }
    if (publishable && (typeof value.code !== 'string' || !value.code.trim())) {
      errors.push(`${path}.code is required before a code action can be submitted for review.`)
    }
  }
}

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

function validateBranches(value: unknown, path: string, errors: string[]): void {
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
        if (headerValue === WORKFLOW_ACTION_REMOTE_REFERENCE) {
          errors.push(
            `${childPath}.${header} cannot use "\${remote}" on a new local action because no remote value exists.`
          )
        }
      }
    } else {
      rejectRemoteSecretReferences(child, childPath, errors)
    }
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

function validateVersion(
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
