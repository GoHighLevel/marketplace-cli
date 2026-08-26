import { describe, expect, it } from 'vitest'

import { normalizeVariadicArgs } from '../../../src/lib/shared/arguments.js'

describe('normalizeVariadicArgs', () => {
  it('deduplicates values and reports unknown option-like arguments', () => {
    expect(normalizeVariadicArgs(['one', 'one', 'two'], 'value')).toEqual(['one', 'two'])
    expect(normalizeVariadicArgs([' one ', 'one', ' two '], 'value')).toEqual(['one', 'two'])
    expect(() => normalizeVariadicArgs(['--typo'], 'value')).toThrow(/Unknown option "--typo"/)
    expect(() => normalizeVariadicArgs(['   '], 'value')).toThrow(/Empty value/i)
  })
})
