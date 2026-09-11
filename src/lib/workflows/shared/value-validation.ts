export const WORKFLOW_FIELD_KEY_MAX_LENGTH = 250
export const WORKFLOW_REFERENCE_MAX_LENGTH = 1_000
export const WORKFLOW_VERSION_MAX_LENGTH = 21

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57
}

export function isWorkflowFieldKey(value: string): boolean {
  if (!value || value.length > WORKFLOW_FIELD_KEY_MAX_LENGTH || !isAsciiLetter(value.charCodeAt(0))) return false
  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (!isAsciiLetter(code) && !isAsciiDigit(code) && code !== 95) return false
  }
  return true
}

export function isWorkflowVersion(value: string): boolean {
  if (value.length > WORKFLOW_VERSION_MAX_LENGTH) return false
  const separator = value.indexOf('.')
  if (separator < 1 || separator !== value.lastIndexOf('.') || value.length - separator - 1 < 1) return false
  if (separator > 10 || value.length - separator - 1 > 10) return false
  for (let index = 0; index < value.length; index += 1) {
    if (index !== separator && !isAsciiDigit(value.charCodeAt(index))) return false
  }
  return true
}

export function containsWhitespace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (
      (code >= 9 && code <= 13) ||
      code === 32 ||
      code === 160 ||
      code === 5760 ||
      (code >= 8192 && code <= 8202) ||
      code === 8232 ||
      code === 8233 ||
      code === 8239 ||
      code === 8287 ||
      code === 12_288 ||
      code === 65_279
    )
      return true
  }
  return false
}
