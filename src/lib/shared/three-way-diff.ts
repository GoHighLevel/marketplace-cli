import { isRecord } from '../api/response.js'

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => valuesEqual(item, right[index]))
    )
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key]))
  )
}

export function changedValuePaths(base: unknown, value: unknown, prefix = ''): string[] {
  if (valuesEqual(base, value)) return []
  if (!isRecord(base) || !isRecord(value) || Array.isArray(base) || Array.isArray(value)) return [prefix]
  const paths: string[] = []
  const keys = new Set([...Object.keys(base), ...Object.keys(value)])
  for (const key of [...keys].sort()) {
    const child = prefix ? `${prefix}.${key}` : key
    paths.push(...changedValuePaths(base[key], value[key], child))
  }
  return paths
}

export function valuePathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`)
}

function setValueAtPath(target: Record<string, unknown>, source: Record<string, unknown>, path: string): void {
  const parts = path.split('.')
  if (parts.some(part => UNSAFE_PATH_SEGMENTS.has(part))) {
    throw new Error(`Cannot merge unsafe object path "${path}".`)
  }
  let targetParent = target
  let sourceParent = source
  for (const part of parts.slice(0, -1)) {
    const sourceValue = sourceParent[part]
    if (!isRecord(sourceValue)) return
    if (!isRecord(targetParent[part])) targetParent[part] = {}
    targetParent = targetParent[part] as Record<string, unknown>
    sourceParent = sourceValue
  }
  const field = parts.at(-1) as string
  if (Object.hasOwn(sourceParent, field)) targetParent[field] = structuredClone(sourceParent[field])
  else delete targetParent[field]
}

export function applyValueChanges<T extends Record<string, unknown>>(remote: T, local: T, changes: string[]): T {
  const merged = structuredClone(remote)
  for (const path of changes) setValueAtPath(merged, local, path)
  return merged
}
