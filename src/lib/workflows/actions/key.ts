export const WORKFLOW_ACTION_KEY_PATTERN = /^[a-z][_a-z0-9]*$/
export const WORKFLOW_ACTION_KEY_MAX_LENGTH = 250

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const RESERVED_PREFIXES = ['iatf_', 'lc_']

export function workflowActionKeyValidationErrors(key: string): string[] {
  const errors: string[] = []
  if (!WORKFLOW_ACTION_KEY_PATTERN.test(key)) {
    errors.push('must start with a lowercase letter and contain only lowercase letters, numbers, and underscores')
  }
  if (key.length > WORKFLOW_ACTION_KEY_MAX_LENGTH) {
    errors.push(`must be at most ${WORKFLOW_ACTION_KEY_MAX_LENGTH} characters`)
  }
  const lower = key.toLowerCase()
  for (const prefix of RESERVED_PREFIXES) {
    if (lower.startsWith(prefix)) errors.push(`cannot start with the reserved prefix "${prefix}"`)
  }
  if (WINDOWS_RESERVED_NAME.test(key)) errors.push(`"${key}" is reserved by the operating system`)
  return errors
}
