import { describe, expect, it } from 'vitest'

import { errorMessage } from '../../../src/lib/shared/errors.js'

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('returns the fallback for non-Error values', () => {
    expect(errorMessage('boom', 'fallback')).toBe('fallback')
    expect(errorMessage(undefined, 'fallback')).toBe('fallback')
    expect(errorMessage({ message: 'boom' }, 'fallback')).toBe('fallback')
  })
})
