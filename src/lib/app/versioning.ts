import { type VersionListItem } from '../api/client.js'
import { normalizeStatus } from './rules.js'

export type BumpType = 'patch' | 'minor' | 'major'

export interface BumpOption {
  type: BumpType
  version: string
  disabledReason?: string
}

const BUMP_ORDER: BumpType[] = ['patch', 'minor', 'major']
const SEMVER_MAX_LENGTH = 32

function semverParts(value: string): [number, number, number] | undefined {
  if (value.length > SEMVER_MAX_LENGTH) return undefined
  const components = value.split('.')
  if (components.length !== 3) return undefined
  const parts: number[] = []
  for (const component of components) {
    if (!component || component.length > 10) return undefined
    for (let index = 0; index < component.length; index += 1) {
      const code = component.charCodeAt(index)
      if (code < 48 || code > 57) return undefined
    }
    parts.push(Number(component))
  }
  return parts as [number, number, number]
}

/* Portal limits (marketplace-frontend src/constants/versionLimits.ts). */
export const MAX_ACTIVE_VERSIONS = 7
export const MAX_PENDING_VERSIONS = 1
export const MAX_TOTAL_VERSIONS = MAX_ACTIVE_VERSIONS + MAX_PENDING_VERSIONS

export function bumpVersion(base: string, type: BumpType): string {
  const parts = semverParts(base)
  if (!parts) throw new Error(`"${base}" is not a valid semver version (expected x.y.z).`)
  const [major, minor, patch] = parts
  if (type === 'major') return `${major + 1}.0.0`
  if (type === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function compareVersions(a: string, b: string): number {
  const [pa, pb] = [semverParts(a), semverParts(b)]
  if (!pa || !pb) return 0
  for (let index = 0; index < 3; index += 1) {
    const diff = Number(pa[index]) - Number(pb[index])
    if (diff !== 0) return diff
  }
  return 0
}

/* The portal's base for bumping: the highest existing version that is not
   a draft or disapproved. Undefined means this is the first publish. */
export function baseVersionFromList(versions: VersionListItem[]): string | undefined {
  const candidates = versions.filter(item => {
    const status = normalizeStatus(item.status)
    return (
      status !== 'draft' &&
      status !== 'disapproved' &&
      typeof item.version === 'string' &&
      semverParts(item.version) !== undefined
    )
  })
  if (candidates.length === 0) return undefined
  return candidates
    .map(item => item.version as string)
    .sort(compareVersions)
    .at(-1)
}

export function activeVersionCount(versions: VersionListItem[]): number {
  return versions.filter(item => ['live', 'deprecated', 'deprecating'].includes(normalizeStatus(item.status))).length
}

export function pendingVersions(versions: VersionListItem[], excludeId?: string): VersionListItem[] {
  return versions.filter(
    item =>
      item._id !== excludeId && ['review', 'inreview', 'draft', 'disapproved'].includes(normalizeStatus(item.status))
  )
}

export function requireDraftable(versions: VersionListItem[], selectedId: string): void {
  if (versions.length >= MAX_TOTAL_VERSIONS) {
    throw new Error(`Apps can keep at most ${MAX_TOTAL_VERSIONS} versions — remove an unused version first.`)
  }
  const pending = pendingVersions(versions)
  if (pending.length >= MAX_PENDING_VERSIONS) {
    throw new Error(
      `A pending version (${pending[0].version ?? pending[0]._id}) already exists — finish or withdraw it before creating another draft.`
    )
  }
  const liveVersions = versions.filter(
    item =>
      normalizeStatus(item.status) === 'live' &&
      typeof item.version === 'string' &&
      semverParts(item.version) !== undefined
  )
  const latest = [...liveVersions].sort((left, right) => compareVersions(right.version ?? '', left.version ?? ''))[0]
  if (!latest) throw new Error('Cannot create a draft: no valid live version is available.')
  if (latest._id !== selectedId) {
    throw new Error(`Drafts can only be cloned from the latest live version (${latest.version}).`)
  }
}

export function minimumBumpFromAnalysis(analysis: unknown): BumpType | undefined {
  if (typeof analysis !== 'object' || analysis === null) return undefined
  const record = analysis as Record<string, unknown>
  const raw = record.updateType ?? record.update_type
  return typeof raw === 'string' && BUMP_ORDER.includes(raw as BumpType) ? (raw as BumpType) : undefined
}

/* Mirrors the portal's version-bump picker: options below the analyze API's
   suggested bump are disabled; major is disabled at the active-version cap. */
export function bumpOptions(input: {
  baseVersion: string
  minimumBump?: BumpType
  activeVersionCount: number
}): BumpOption[] {
  const minIndex = input.minimumBump ? BUMP_ORDER.indexOf(input.minimumBump) : 0
  const maxIndex = input.activeVersionCount >= MAX_ACTIVE_VERSIONS ? BUMP_ORDER.indexOf('minor') : BUMP_ORDER.length - 1
  return BUMP_ORDER.map((type, index) => {
    const option: BumpOption = { type, version: bumpVersion(input.baseVersion, type) }
    if (index < minIndex) {
      option.disabledReason = `the changes in this draft require at least a ${input.minimumBump} bump`
    } else if (index > maxIndex) {
      option.disabledReason = `apps can keep at most ${MAX_ACTIVE_VERSIONS} active versions — retire one before a major release`
    }
    return option
  })
}

/* Mirrors the portal's deprecate gating: a lone version can always be
   deprecated; otherwise the app must keep a newer live version, and the
   active-version cap must not be exceeded. */
export function requireDeprecatable(versions: VersionListItem[], selectedId: string): void {
  if (versions.length <= 1) return
  const actives = versions.filter(
    item =>
      item._id !== selectedId &&
      ['review', 'inreview', 'deprecating', 'deprecated', 'live'].includes(normalizeStatus(item.status))
  )
  if (actives.length + 1 > MAX_ACTIVE_VERSIONS) {
    throw new Error(
      `Apps can keep at most ${MAX_ACTIVE_VERSIONS} active versions — this deprecation would exceed the limit.`
    )
  }
  const liveVersions = versions.filter(item => normalizeStatus(item.status) === 'live')
  if (liveVersions.length < 2) {
    throw new Error('The only live version cannot be deprecated — publish a newer version first.')
  }
  const latestLive = liveVersions
    .filter(item => typeof item.version === 'string' && semverParts(item.version) !== undefined)
    .map(item => item.version as string)
    .sort(compareVersions)
    .at(-1)
  const selected = versions.find(item => item._id === selectedId)
  if (latestLive !== undefined && selected?.version === latestLive) {
    throw new Error('The latest live version cannot be deprecated — only older live versions can be retired.')
  }
}

export function validateNewVersion(value: string, options: BumpOption[]): true | string {
  if (value.length > SEMVER_MAX_LENGTH) return `Version must be at most ${SEMVER_MAX_LENGTH} characters.`
  if (!semverParts(value)) return `"${value}" is not a valid semver version (expected x.y.z).`
  const match = options.find(option => option.version === value)
  if (!match) {
    const allowed = options.filter(option => !option.disabledReason).map(option => `${option.version} (${option.type})`)
    return `Version must be one of: ${allowed.join(', ')} — the portal only allows single patch/minor/major bumps of the current version.`
  }
  if (match.disabledReason) return `Version ${value} is not allowed: ${match.disabledReason}.`
  return true
}
