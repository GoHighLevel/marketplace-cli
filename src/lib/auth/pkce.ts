import { createHash, randomBytes } from 'node:crypto'

export interface PkcePair {
  verifier: string
  challenge: string
}

/* The verifier never leaves this process; only its SHA-256 hash
   travels through the browser, so a leaked code can't be redeemed. */
export function generatePkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function generateState(): string {
  return randomBytes(16).toString('base64url')
}
