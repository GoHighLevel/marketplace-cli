import { isRecord } from '../../../api/response.js'
import { validateHttpsUrl } from '../../../shared/validation.js'
import {
  optionalBoolean,
  optionalNonNegativeInteger,
  optionalString,
  requireArray,
  requireRecord,
  requiredString,
  stringArray,
  unknownProperties
} from '../../shared/schema-primitives.js'
import { validateFunctionExpression, validateJavaScriptBlock } from './code.js'
import { validateHeaders } from './headers.js'

export const METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])

export function validateOptions(value: unknown, path: string, errors: string[]): void {
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

export function validatePublicHttpsUrl(value: unknown, path: string, errors: string[], required = false): void {
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

export function validateFetchOptions(value: unknown, path: string, errors: string[]): void {
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

export function validateBranchFetchOptions(value: unknown, path: string, errors: string[]): void {
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

export function validateDynamicFieldsConfig(value: unknown, path: string, errors: string[]): void {
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

export function validateDynamicSource(value: unknown, path: string, errors: string[], allowPagination = true): void {
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
