import { describe, expect, it } from 'vitest'

import { formatIsoDate } from '../../../src/lib/shared/date.js'

describe('formatIsoDate', () => {
  it('formats valid dates and uses the requested fallback for missing or invalid values', () => {
    expect(formatIsoDate('2026-08-11T05:00:00.000Z')).toBe('2026-08-11')
    expect(formatIsoDate(undefined)).toBe('')
    expect(formatIsoDate('invalid', '-')).toBe('-')
  })
})
