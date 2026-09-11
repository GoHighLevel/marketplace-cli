import {
  applyValueChanges as applyChanges,
  changedValuePaths as changedPaths,
  valuePathsOverlap as pathsOverlap,
  valuesEqual as equal
} from '../../shared/three-way-diff.js'

export interface VersionedWorkflowVersion {
  version: string
  status: string
}

export interface VersionedWorkflowDefinition<TVersion extends VersionedWorkflowVersion> {
  templateId?: string
  key: string
  versions: TVersion[]
}

export interface VersionedWorkflowManifest<TDefinition> {
  schemaVersion: 1
  appId: string
  items: TDefinition[]
}

export interface CreateVersionedWorkflowOperation<TDefinition> {
  type: 'create'
  key: string
  desired: TDefinition
}

export interface DeleteVersionedWorkflowOperation {
  type: 'delete'
  key: string
  templateId: string
}

export interface UpdateVersionedWorkflowOperation<TVersion> {
  type: 'update'
  key: string
  templateId: string
  version: string
  desired: TVersion
  current: TVersion
  updateSummary: boolean
}

export type VersionedWorkflowSyncOperation<TDefinition, TVersion> =
  | CreateVersionedWorkflowOperation<TDefinition>
  | DeleteVersionedWorkflowOperation
  | UpdateVersionedWorkflowOperation<TVersion>

export interface VersionedWorkflowSyncPlan<TDefinition, TVersion> {
  appId: string
  localChanges: string[]
  remoteChanges: string[]
  conflicts: string[]
  errors: string[]
  operations: Array<VersionedWorkflowSyncOperation<TDefinition, TVersion>>
}

interface VersionedWorkflowDescriptor {
  collection: 'actions' | 'triggers'
  singular: 'action' | 'trigger'
  command: 'actions' | 'triggers'
}

function editableVersion<TVersion extends VersionedWorkflowVersion>(version: TVersion): Record<string, unknown> {
  const { version: _version, status: _status, ...editable } = version
  return editable
}

function definitionMap<
  TVersion extends VersionedWorkflowVersion,
  TDefinition extends VersionedWorkflowDefinition<TVersion>
>(definitions: TDefinition[]): Map<string, TDefinition> {
  return new Map(definitions.map(definition => [definition.key, definition]))
}

function versionMap<TVersion extends VersionedWorkflowVersion>(
  definition: VersionedWorkflowDefinition<TVersion>
): Map<string, TVersion> {
  return new Map(definition.versions.map(version => [version.version, version]))
}

function manifestChanges<
  TVersion extends VersionedWorkflowVersion,
  TDefinition extends VersionedWorkflowDefinition<TVersion>
>(
  base: VersionedWorkflowManifest<TDefinition>,
  value: VersionedWorkflowManifest<TDefinition>,
  descriptor: VersionedWorkflowDescriptor
): string[] {
  const baseDefinitions = definitionMap(base.items)
  const valueDefinitions = definitionMap(value.items)
  const changes: string[] = []
  for (const key of [...new Set([...baseDefinitions.keys(), ...valueDefinitions.keys()])].sort()) {
    const before = baseDefinitions.get(key)
    const after = valueDefinitions.get(key)
    const definitionPath = `${descriptor.collection}.${key}`
    if (!before || !after) {
      changes.push(definitionPath)
      continue
    }
    if (before.templateId !== after.templateId) changes.push(`${definitionPath}.templateId`)
    const baseVersions = versionMap(before)
    const valueVersions = versionMap(after)
    for (const version of [...new Set([...baseVersions.keys(), ...valueVersions.keys()])].sort()) {
      const beforeVersion = baseVersions.get(version)
      const afterVersion = valueVersions.get(version)
      const versionPath = `${definitionPath}.versions.${version}`
      if (!beforeVersion || !afterVersion) changes.push(versionPath)
      else changes.push(...changedPaths(beforeVersion, afterVersion, versionPath))
    }
  }
  return changes
}

function processExistingDefinition<
  TVersion extends VersionedWorkflowVersion,
  TDefinition extends VersionedWorkflowDefinition<TVersion>
>(
  key: string,
  base: TDefinition,
  local: TDefinition,
  remote: TDefinition,
  plan: VersionedWorkflowSyncPlan<TDefinition, TVersion>,
  descriptor: VersionedWorkflowDescriptor
): void {
  const definitionPath = `${descriptor.collection}.${key}`
  if (local.key !== base.key)
    plan.errors.push(`${definitionPath}.key is immutable; create a new ${descriptor.singular} instead.`)
  if (local.templateId !== base.templateId) {
    plan.errors.push(`${definitionPath}.templateId is server-owned and cannot be changed.`)
  }
  if (remote.templateId !== base.templateId) {
    plan.conflicts.push(`${definitionPath}.templateId`)
    return
  }

  const baseVersions = versionMap(base)
  const localVersions = versionMap(local)
  const remoteVersions = versionMap(remote)
  for (const version of localVersions.keys()) {
    if (!baseVersions.has(version)) {
      plan.errors.push(
        `${definitionPath} version ${version} was added locally; ` +
          `run \`ghl app ${descriptor.command} new-version ${key}\` instead.`
      )
    }
  }
  for (const [version, baseVersion] of baseVersions) {
    const localVersion = localVersions.get(version)
    if (!localVersion) {
      plan.errors.push(`${definitionPath} version ${version} cannot be deleted independently.`)
      continue
    }
    if (localVersion.status !== baseVersion.status) {
      plan.errors.push(`${definitionPath} version ${version} status is server-owned and cannot be changed locally.`)
      continue
    }
    const localChanges = changedPaths(editableVersion(baseVersion), editableVersion(localVersion))
    if (localChanges.length === 0) continue
    if (baseVersion.status !== 'draft') {
      plan.errors.push(
        `${definitionPath} version ${version} is ${baseVersion.status} and cannot be edited; ` +
          `run \`ghl app ${descriptor.command} new-version ${key}\` first.`
      )
      continue
    }
    const remoteVersion = remoteVersions.get(version)
    if (!remoteVersion) {
      plan.conflicts.push(`${definitionPath}.versions.${version}`)
      continue
    }
    const remoteChanges = changedPaths(editableVersion(baseVersion), editableVersion(remoteVersion))
    const conflicts = localChanges.filter(localPath =>
      remoteChanges.some(remotePath => pathsOverlap(localPath, remotePath))
    )
    if (conflicts.length > 0) {
      plan.conflicts.push(...conflicts.map(path => `${definitionPath}.versions.${version}.${path}`))
      continue
    }
    const desiredEditable = applyChanges(editableVersion(remoteVersion), editableVersion(localVersion), localChanges)
    const desired = {
      version: remoteVersion.version,
      status: remoteVersion.status,
      ...desiredEditable
    } as unknown as TVersion
    plan.operations.push({
      type: 'update',
      key,
      templateId: remote.templateId as string,
      version,
      desired,
      current: remoteVersion,
      updateSummary: localChanges.some(path => pathsOverlap(path, 'info.name'))
    })
  }
}

export function planVersionedWorkflowSync<
  TVersion extends VersionedWorkflowVersion,
  TDefinition extends VersionedWorkflowDefinition<TVersion>
>(
  baseline: VersionedWorkflowManifest<TDefinition>,
  local: VersionedWorkflowManifest<TDefinition>,
  remote: VersionedWorkflowManifest<TDefinition>,
  descriptor: VersionedWorkflowDescriptor
): VersionedWorkflowSyncPlan<TDefinition, TVersion> {
  const plan: VersionedWorkflowSyncPlan<TDefinition, TVersion> = {
    appId: local.appId,
    localChanges: manifestChanges(baseline, local, descriptor),
    remoteChanges: manifestChanges(baseline, remote, descriptor),
    conflicts: [],
    errors: [],
    operations: []
  }
  if (baseline.appId !== local.appId || baseline.appId !== remote.appId) {
    plan.errors.push(`Workflow ${descriptor.singular} app bindings do not match; pull the app again before pushing.`)
    return plan
  }

  const baseDefinitions = definitionMap(baseline.items)
  const localDefinitions = definitionMap(local.items)
  const remoteDefinitions = definitionMap(remote.items)
  const localByTemplate = new Map(
    local.items.filter(item => item.templateId).map(item => [item.templateId as string, item])
  )
  for (const base of baseline.items) {
    if (!base.templateId) continue
    const matchingLocal = localByTemplate.get(base.templateId)
    if (matchingLocal && matchingLocal.key !== base.key) {
      plan.errors.push(
        `${descriptor.collection}.${base.key}.key is immutable; create a separate ${descriptor.singular} ` +
          `and explicitly delete the old one.`
      )
    }
  }

  for (const key of [
    ...new Set([...baseDefinitions.keys(), ...localDefinitions.keys(), ...remoteDefinitions.keys()])
  ].sort()) {
    const base = baseDefinitions.get(key)
    const desired = localDefinitions.get(key)
    const current = remoteDefinitions.get(key)
    const definitionPath = `${descriptor.collection}.${key}`
    if (!base && desired) {
      if (desired.templateId)
        plan.errors.push(`${definitionPath}.templateId must be omitted for a new local ${descriptor.singular}.`)
      else if (current) plan.conflicts.push(definitionPath)
      else plan.operations.push({ type: 'create', key, desired })
      continue
    }
    if (base && !desired) {
      if (!current) continue
      if (!equal(base, current)) plan.conflicts.push(definitionPath)
      else if (current.templateId) plan.operations.push({ type: 'delete', key, templateId: current.templateId })
      else plan.errors.push(`${definitionPath}.templateId is missing; pull the app again before deleting it.`)
      continue
    }
    if (!base || !desired) continue
    if (!current) {
      if (!equal(base, desired)) plan.conflicts.push(definitionPath)
      continue
    }
    processExistingDefinition(key, base, desired, current, plan, descriptor)
  }

  plan.localChanges = [...new Set(plan.localChanges)].sort()
  plan.remoteChanges = [...new Set(plan.remoteChanges)].sort()
  plan.conflicts = [...new Set(plan.conflicts)].sort()
  plan.errors = [...new Set(plan.errors)].sort()
  if (plan.conflicts.length > 0 || plan.errors.length > 0) {
    plan.operations = []
  } else {
    const priority = { update: 0, create: 1, delete: 2 } as const
    plan.operations.sort(
      (left, right) => priority[left.type] - priority[right.type] || left.key.localeCompare(right.key)
    )
  }
  return plan
}
