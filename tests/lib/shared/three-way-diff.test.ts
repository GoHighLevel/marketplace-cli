import { describe, expect, it } from 'vitest'

import { applyValueChanges } from '../../../src/lib/shared/three-way-diff.js'

describe('three-way object merges', () => {
  it('rejects prototype mutation paths', () => {
    expect(() => applyValueChanges({}, {}, ['__proto__.polluted'])).toThrow(/unsafe object path/i)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
