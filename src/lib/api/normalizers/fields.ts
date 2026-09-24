export function hasOptionalStringFields(value: Record<string, unknown>, fields: string[], allowNull = false): boolean {
  return fields.every(
    field => value[field] === undefined || (allowNull && value[field] === null) || typeof value[field] === 'string'
  )
}

export function hasOptionalBooleanFields(value: Record<string, unknown>, fields: string[], allowNull = false): boolean {
  return fields.every(
    field => value[field] === undefined || (allowNull && value[field] === null) || typeof value[field] === 'boolean'
  )
}

export function hasOptionalFiniteNumberFields(
  value: Record<string, unknown>,
  fields: string[],
  allowNull = false
): boolean {
  return fields.every(field => {
    const fieldValue = value[field]
    return (
      fieldValue === undefined ||
      (allowNull && fieldValue === null) ||
      (typeof fieldValue === 'number' && Number.isFinite(fieldValue))
    )
  })
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function hasOptionalStringArrayFields(
  value: Record<string, unknown>,
  fields: string[],
  allowNull = false
): boolean {
  return fields.every(
    field => value[field] === undefined || (allowNull && value[field] === null) || isStringArray(value[field])
  )
}
