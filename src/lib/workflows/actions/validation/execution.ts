import { isRecord } from '../../../api/response.js'
import { validateHttpUrl } from '../../../shared/validation.js'
import { optionalBoolean, requireRecord, unknownProperties } from '../../shared/schema-primitives.js'
import { WORKFLOW_ACTION_CODE_MAX_BYTES } from '../code.js'
import { validateJavaScriptBlock } from './code.js'
import { validateHeaders } from './headers.js'
import { METHODS } from './sources.js'

export function validateExecution(
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
