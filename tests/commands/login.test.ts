import { describe, expect, it } from 'vitest'

import { buildAuthorizeUrl, loginSuccessMessage } from '../../src/commands/login.js'

describe('login command', () => {
  it('builds the browser login URL on the configured developer portal', () => {
    const authorizeUrl = buildAuthorizeUrl('https://marketplace.gohighlevel.com', {
      challenge: 'pkce-challenge',
      state: 'request-state',
      port: 51_234
    })

    expect(authorizeUrl.href).toBe(
      'https://marketplace.gohighlevel.com/cli-auth?challenge=pkce-challenge&state=request-state&port=51234'
    )
  })

  it('confirms login without exposing the credentials directory', () => {
    const message = loginSuccessMessage('developer@example.com')

    expect(message).toBe('Logged in successfully as developer@example.com.')
    expect(message).not.toMatch(/credentials|saved|[/\\]/i)
  })

  it('confirms login when developer metadata is unavailable', () => {
    expect(loginSuccessMessage()).toBe('Logged in successfully.')
  })
})
