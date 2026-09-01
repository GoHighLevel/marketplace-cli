import { describe, expect, it } from 'vitest'

import { extractApiErrorMessage, isRecord, readApiResponse } from '../../../src/lib/api/response.js'

describe('API response helpers', () => {
  it('recognizes records without accepting arrays or null', () => {
    expect(isRecord({ ok: true })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
  })

  it('extracts safe messages from common backend error envelopes', () => {
    expect(extractApiErrorMessage('{"message":["A","B"]}')).toBe('A; B')
    expect(extractApiErrorMessage('{"error":"Denied"}')).toBe('Denied')
    expect(extractApiErrorMessage('<html>proxy failed</html>', 'Bad Gateway')).toBe('Bad Gateway')
    expect(extractApiErrorMessage(JSON.stringify({ message: '\u001b[31mDenied\u001b[0m\nAgain' }))).toBe('Denied Again')
    expect(extractApiErrorMessage(JSON.stringify({ message: 'x'.repeat(600) }))).toHaveLength(500)
  })

  it('does not treat an unreadable successful response as empty content', async () => {
    const response = {
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('stream failed')
      }
    } as Response
    await expect(
      readApiResponse(response, { failureLabel: 'API failed', responseLabel: 'API request' })
    ).rejects.toThrow(/could not be read/i)
  })
})
