import { isRecord } from '../response.js'
import type { SandboxAccount } from '../types.js'

export function isSandboxAccount(value: unknown): value is SandboxAccount {
  if (!isRecord(value)) return false
  if (typeof value._id !== 'string' || !value._id) return false
  if (typeof value.name !== 'string' || !value.name) return false
  if (typeof value.companyId !== 'string' || !value.companyId) return false

  return ['relationshipNumber', 'expiryDate', 'status'].every(
    field => value[field] === undefined || typeof value[field] === 'string'
  )
}
