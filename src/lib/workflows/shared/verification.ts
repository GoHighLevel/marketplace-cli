import { isRecord } from '../../api/response.js'

interface CanonicalWorkflowConfigOptions {
  ignoredKeys?: string[]
  isSecretReference: (value: string) => boolean
}

export function canonicalWorkflowConfig(
  value: unknown,
  options: CanonicalWorkflowConfigOptions
): unknown {
  const ignoredKeys = new Set(options.ignoredKeys ?? [])
  const visit = (current: unknown): unknown => {
    if (typeof current === 'string' && options.isSecretReference(current)) return '${secret}'
    if (Array.isArray(current)) {
      const items = current.map(visit).filter(item => item !== undefined)
      return items.length > 0 ? items : undefined
    }
    if (!isRecord(current)) return current
    const entries = Object.keys(current)
      .filter(key => !ignoredKeys.has(key))
      .sort()
      .map(key => [key, visit(current[key])] as const)
      .filter(([, entry]) => entry !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }
  return visit(value)
}
