import { describe, expect, it } from 'vitest'

import { publishReadinessSymbol } from '../../../src/lib/app/publish-readiness.js'

describe('publishReadinessSymbol', () => {
  it('uses unambiguous symbols for satisfied and missing requirements', () => {
    expect(publishReadinessSymbol(true)).toBe('[✓]')
    expect(publishReadinessSymbol(false)).toBe('[x]')
  })
})
