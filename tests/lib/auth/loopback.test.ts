import { describe, expect, it } from 'vitest'

import { handleLoopbackCallback } from '../../../src/lib/auth/loopback.js'

describe('loopback callback', () => {
  it('accepts the code when state matches', () => {
    expect(handleLoopbackCallback('GET', '/callback?code=abc&state=state123', 'state123')).toMatchObject({
      status: 200,
      code: 'abc'
    })
  })

  it('rejects when state does not match', () => {
    const result = handleLoopbackCallback('GET', '/callback?code=abc&state=evil', 'state123')
    expect(result.status).toBe(400)
    expect(result.error?.message).toMatch(/state mismatch/)
  })

  it('rejects when the browser reports an error', () => {
    const result = handleLoopbackCallback('GET', '/callback?error=access_denied&state=state123', 'state123')
    expect(result.status).toBe(200)
    expect(result.error?.message).toMatch(/denied/)
  })

  it('404s unknown paths and methods', () => {
    expect(handleLoopbackCallback('GET', '/other', 'state123')).toEqual({ status: 404 })
    expect(handleLoopbackCallback('POST', '/callback?code=abc&state=state123', 'state123')).toEqual({ status: 404 })
  })
})
