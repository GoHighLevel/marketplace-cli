import { describe, expect, it } from 'vitest'

import {
  optionalBoolean,
  optionalInteger,
  optionalNonNegativeInteger,
  optionalString,
  propertyPath,
  requireArray,
  requireRecord,
  requiredString,
  stringArray,
  unknownProperties
} from '../../../../src/lib/workflows/shared/schema-primitives.js'

describe('schema primitives', () => {
  it('quotes property names that are not identifiers', () => {
    expect(propertyPath('info', 'name')).toBe('info.name')
    expect(propertyPath('headers', 'X-Api Key')).toBe('headers["X-Api Key"]')
  })

  it('reports unsupported properties by path', () => {
    const errors: string[] = []
    unknownProperties({ name: 'a', extra: 1 }, new Set(['name']), 'info', errors)
    expect(errors).toEqual(['info.extra is not a supported property.'])
  })

  it('narrows records, arrays, and strings while collecting errors', () => {
    const errors: string[] = []
    expect(requireRecord({}, 'a', errors)).toBe(true)
    expect(requireRecord([], 'b', errors)).toBe(false)
    expect(requireArray([], 'c', errors)).toBe(true)
    expect(requireArray({}, 'd', errors)).toBe(false)
    expect(requiredString('x', 'e', errors)).toBe(true)
    expect(requiredString('  ', 'f', errors)).toBe(false)
    expect(errors).toEqual(['b must be an object.', 'd must be an array.', 'f must be a non-empty string.'])
  })

  it('accepts undefined for optional scalars and rejects other types', () => {
    const errors: string[] = []
    optionalString(undefined, 'a', errors)
    optionalString(1, 'b', errors)
    optionalBoolean(undefined, 'c', errors)
    optionalBoolean('yes', 'd', errors)
    optionalInteger(3, 'e', errors, { min: 2, max: 5 })
    optionalInteger(9, 'f', errors, { min: 2, max: 5 })
    optionalInteger(1.5, 'g', errors)
    expect(optionalNonNegativeInteger(2, 'h', errors)).toBe(2)
    expect(optionalNonNegativeInteger(-1, 'i', errors)).toBeUndefined()
    expect(errors).toEqual([
      'b must be a string.',
      'd must be a boolean.',
      'f must be an integer between 2 and 5.',
      'g must be an integer.',
      'i must be a non-negative integer.'
    ])
  })

  it('validates every string array item', () => {
    const errors: string[] = []
    stringArray(['a', 1], 'keywords', errors)
    stringArray('nope', 'other', errors)
    expect(errors).toEqual(['keywords[1] must be a string.', 'other must be an array.'])
  })
})
