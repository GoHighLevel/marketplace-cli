import { describe, expect, it } from 'vitest'

import { CodedError, codedErrorText, errorMessage } from '../../../src/lib/shared/errors.js'

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

describe('CodedError', () => {
  it('carries a machine-readable code next to the user-facing message', () => {
    const error = new CodedError('DOC_NOT_FOUND', 'No page.')
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('DOC_NOT_FOUND')
    expect(errorMessage(error, 'fallback')).toBe('No page.')
  })
})

describe('codedErrorText', () => {
  it('prefixes the code of a coded error, or the fallback code otherwise', () => {
    expect(codedErrorText(new CodedError('DOC_NOT_FOUND', 'No page.'), 'INTERNAL_ERROR')).toBe(
      'DOC_NOT_FOUND: No page.'
    )
    expect(codedErrorText(new Error('boom'), 'INTERNAL_ERROR')).toBe('INTERNAL_ERROR: boom')
    expect(codedErrorText('boom', 'INTERNAL_ERROR')).toBe('INTERNAL_ERROR: The operation failed.')
  })
})
