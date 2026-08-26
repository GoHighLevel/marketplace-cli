import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { generatePkcePair, generateState } from '../../../src/lib/auth/pkce.js'

describe('generatePkcePair', () => {
  it('returns a challenge that is the base64url sha256 of the verifier', () => {
    const { verifier, challenge } = generatePkcePair()
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
  })

  it('generates unique high-entropy verifiers', () => {
    const a = generatePkcePair()
    const b = generatePkcePair()
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.verifier.length).toBeGreaterThanOrEqual(43)
  })
})

describe('generateState', () => {
  it('generates unique values', () => {
    expect(generateState()).not.toBe(generateState())
  })
})
