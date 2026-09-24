import { isRecord } from '../../../api/response.js'
import { propertyPath, requireRecord } from '../../shared/schema-primitives.js'
import {
  WORKFLOW_ACTION_ENV_REFERENCE,
  WORKFLOW_ACTION_REMOTE_REFERENCE,
  isWorkflowActionSecretReference,
  workflowActionHeaderRequiresReference
} from '../secrets.js'

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export function validateHeaders(value: unknown, path: string, errors: string[]): void {
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

export function rejectRemoteSecretReferences(value: unknown, path: string, errors: string[]): void {
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
