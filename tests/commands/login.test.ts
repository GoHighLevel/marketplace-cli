import { describe, expect, it } from 'vitest'

import { loginSuccessMessage } from '../../src/commands/login.js'

describe('login command', () => {
  it('confirms login without exposing the credentials directory', () => {
    const message = loginSuccessMessage('developer@example.com')

    expect(message).toBe('Logged in successfully as developer@example.com.')
    expect(message).not.toMatch(/credentials|saved|[/\\]/i)
  })

  it('confirms login when developer metadata is unavailable', () => {
    expect(loginSuccessMessage()).toBe('Logged in successfully.')
  })
})
