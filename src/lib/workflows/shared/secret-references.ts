export const WORKFLOW_REMOTE_REFERENCE = '${remote}'
export const WORKFLOW_ENV_REFERENCE = /^\$\{env:[A-Z_][A-Z0-9_]*\}$/

const SAFE_LITERAL_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'content-type',
  'user-agent'
])

export function workflowHeaderRequiresReference(name: string): boolean {
  return !SAFE_LITERAL_HEADERS.has(name.trim().toLowerCase())
}

export function isWorkflowSecretReference(value: string): boolean {
  return value === WORKFLOW_REMOTE_REFERENCE || WORKFLOW_ENV_REFERENCE.test(value)
}

export function workflowEnvironmentVariable(value: string): string | undefined {
  return /^\$\{env:([A-Z_][A-Z0-9_]*)\}$/.exec(value)?.[1]
}
