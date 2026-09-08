import {
  applyValueChanges,
  changedValuePaths,
  valuePathsOverlap,
  valuesEqual
} from '../shared/three-way-diff.js'
import { ExternalAuthManifest } from './manifest.js'

export interface ExternalAuthSyncOptions {
  status?: string
}

export interface ExternalAuthSyncPlan {
  desired: ExternalAuthManifest
  localChanges: string[]
  remoteChanges: string[]
  conflicts: string[]
  errors: string[]
  updateRequired: boolean
}

const IMMUTABLE_FIELDS = new Set(['schemaVersion', 'appId', 'versionId'])

function editablePaths(base: ExternalAuthManifest, value: ExternalAuthManifest): string[] {
  return changedValuePaths(base, value).filter(path => !IMMUTABLE_FIELDS.has(path))
}

function immutableErrors(base: ExternalAuthManifest, local: ExternalAuthManifest): string[] {
  const errors: string[] = []
  if (local.schemaVersion !== base.schemaVersion) errors.push('config.json.schemaVersion is immutable.')
  if (local.appId !== base.appId) {
    errors.push('config.json.appId is immutable; run `ghl app external-auth pull` for another app.')
  }
  if (local.versionId !== base.versionId) {
    errors.push('config.json.versionId is immutable; run `ghl app external-auth pull` for another version.')
  }
  return errors
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function planExternalAuthSync(
  baseline: ExternalAuthManifest,
  local: ExternalAuthManifest,
  remote: ExternalAuthManifest,
  options: ExternalAuthSyncOptions = {}
): ExternalAuthSyncPlan {
  const localChanges = editablePaths(baseline, local)
  const remoteChanges = editablePaths(baseline, remote)
  const conflicts = localChanges.filter(localPath => remoteChanges.some(remotePath => {
    if (!valuePathsOverlap(localPath, remotePath)) return false
    const comparisonPath = localPath.length <= remotePath.length ? localPath : remotePath
    return !valuesEqual(valueAtPath(local, comparisonPath), valueAtPath(remote, comparisonPath))
  }))
  const errors = immutableErrors(baseline, local)
  if (remote.appId !== baseline.appId || remote.versionId !== baseline.versionId) {
    errors.push('The remote external-auth configuration does not match the workspace app and version.')
  }
  if (localChanges.length > 0 && options.status && options.status !== 'draft') {
    errors.push('External authentication can only be changed on a draft app version.')
  }

  const desired = applyValueChanges(
    remote as unknown as Record<string, unknown>,
    local as unknown as Record<string, unknown>,
    localChanges.filter(localPath => !conflicts.some(conflict => valuePathsOverlap(localPath, conflict)))
  ) as unknown as ExternalAuthManifest
  return {
    desired,
    localChanges,
    remoteChanges,
    conflicts,
    errors,
    updateRequired: errors.length === 0 && conflicts.length === 0 && !valuesEqual(desired, remote)
  }
}
