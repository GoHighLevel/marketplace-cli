import { isRecord } from '../../api/response.js'

/* Structural checks shared by the workflow action and trigger manifest validators.
   Every helper appends a path-qualified message to `errors` and returns a
   narrowing result where that helps the caller. */

export function propertyPath(path: string, property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(property) ? `${path}.${property}` : `${path}[${JSON.stringify(property)}]`
}

export function unknownProperties(value: unknown, allowed: Set<string>, path: string, errors: string[]): void {
  if (!isRecord(value)) return
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${propertyPath(path, key)} is not a supported property.`)
  }
}

export function requireRecord(value: unknown, path: string, errors: string[]): value is Record<string, unknown> {
  if (isRecord(value)) return true
  errors.push(`${path} must be an object.`)
  return false
}

export function requireArray(value: unknown, path: string, errors: string[]): value is unknown[] {
  if (Array.isArray(value)) return true
  errors.push(`${path} must be an array.`)
  return false
}

export function requiredString(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value === 'string' && value.trim()) return true
  errors.push(`${path} must be a non-empty string.`)
  return false
}

export function optionalString(value: unknown, path: string, errors: string[]): void {
  if (value !== undefined && typeof value !== 'string') errors.push(`${path} must be a string.`)
}

export function optionalBoolean(value: unknown, path: string, errors: string[]): void {
  if (value !== undefined && typeof value !== 'boolean') errors.push(`${path} must be a boolean.`)
}

export function optionalInteger(
  value: unknown,
  path: string,
  errors: string[],
  range?: { min: number; max: number }
): void {
  if (value === undefined) return
  if (!Number.isInteger(value)) {
    errors.push(`${path} must be an integer${range ? ` between ${range.min} and ${range.max}` : ''}.`)
    return
  }
  if (range && ((value as number) < range.min || (value as number) > range.max)) {
    errors.push(`${path} must be an integer between ${range.min} and ${range.max}.`)
  }
}

export function optionalNonNegativeInteger(value: unknown, path: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    errors.push(`${path} must be a non-negative integer.`)
    return undefined
  }
  return value
}

export function stringArray(value: unknown, path: string, errors: string[]): void {
  if (!requireArray(value, path, errors)) return
  value.forEach((item, index) => {
    if (typeof item !== 'string') errors.push(`${path}[${index}] must be a string.`)
  })
}
