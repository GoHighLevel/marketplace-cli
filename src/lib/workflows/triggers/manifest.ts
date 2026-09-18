import { isRecord } from '../../api/response.js'
import { hydrateWorkflowHeaders, redactWorkflowHeaders } from '../shared/nested-headers.js'

export type WorkflowTriggerStatus = 'draft' | 'in_review' | 'published'

export interface WorkflowTriggerInfo {
  name: string
  description?: string
  summary?: string
  groupName?: string
  keywords?: string[]
  icon?: string
  screenshots?: string[]
}

export interface WorkflowTriggerOption {
  label: string
  value: string
  description?: string
  disabled?: boolean
  icon?: string
  iconUrl?: string
}

export interface WorkflowTriggerFilter {
  field: string
  title: string
  required?: boolean
  fieldType: string
  options?: WorkflowTriggerOption[]
  fetchOptions?: Record<string, unknown>
  mappedTo?: string
  altersDynamicField?: boolean
  dynamicFieldsConfig?: Record<string, unknown>
}

export interface WorkflowTriggerCustomVariable {
  name: string
  reference: string
  fieldType: string
}

export interface WorkflowTriggerVersion {
  version: string
  status: WorkflowTriggerStatus
  info: WorkflowTriggerInfo
  filters?: WorkflowTriggerFilter[]
  customVars?: WorkflowTriggerCustomVariable[]
  customVarsJson?: Record<string, unknown>
  subscriptionConfig?: {
    url: string
    headers?: Record<string, string>
  }
}

export interface WorkflowTriggerDefinition {
  templateId?: string
  key: string
  versions: WorkflowTriggerVersion[]
}

export interface WorkflowTriggersManifest {
  schemaVersion: 1
  appId: string
  triggers: WorkflowTriggerDefinition[]
}

export type WorkflowTriggerUpdateBody = Omit<WorkflowTriggerVersion, 'version'>

const INFO_FIELDS = ['name', 'description', 'summary', 'groupName', 'keywords', 'icon', 'screenshots'] as const
const FILTER_FIELDS = [
  'field',
  'title',
  'required',
  'fieldType',
  'options',
  'fetchOptions',
  'mappedTo',
  'altersDynamicField',
  'dynamicFieldsConfig'
] as const

function clone<T>(value: T): T {
  return structuredClone(value)
}

function copyKnown(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    if (source[field] !== undefined) result[field] = clone(source[field])
  }
  return result
}

function toInfo(value: unknown, fallbackName = ''): WorkflowTriggerInfo {
  const source = isRecord(value) ? value : {}
  return copyKnown(
    { ...source, name: typeof source.name === 'string' ? source.name : fallbackName },
    INFO_FIELDS
  ) as unknown as WorkflowTriggerInfo
}

function toFilter(value: unknown): WorkflowTriggerFilter | undefined {
  if (!isRecord(value)) return undefined
  return copyKnown(value, FILTER_FIELDS) as unknown as WorkflowTriggerFilter
}

function toVersion(remote: Record<string, unknown>): WorkflowTriggerVersion {
  const result: WorkflowTriggerVersion = {
    version: String(remote.version ?? ''),
    status: String(remote.status ?? 'draft') as WorkflowTriggerStatus,
    info: toInfo(remote.info, typeof remote.name === 'string' ? remote.name : '')
  }
  if (Array.isArray(remote.filters)) {
    result.filters = remote.filters.map(toFilter).filter((item): item is WorkflowTriggerFilter => item !== undefined)
  }
  if (Array.isArray(remote.customVars)) {
    result.customVars = clone(remote.customVars) as WorkflowTriggerCustomVariable[]
  }
  if (isRecord(remote.customVarsJson)) {
    result.customVarsJson = clone(remote.customVarsJson)
  } else if (isRecord(remote.sampleResponseJson)) {
    result.customVarsJson = clone(remote.sampleResponseJson)
  }
  if (isRecord(remote.subscriptionConfig)) {
    result.subscriptionConfig = clone(remote.subscriptionConfig) as WorkflowTriggerVersion['subscriptionConfig']
  }
  return result
}

function compareVersions(left: WorkflowTriggerVersion, right: WorkflowTriggerVersion): number {
  const leftNumber = Number.parseFloat(left.version)
  const rightNumber = Number.parseFloat(right.version)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return rightNumber - leftNumber
  }
  return right.version.localeCompare(left.version)
}

export function buildWorkflowTriggersManifest(
  appId: string,
  remoteTriggers: Array<Record<string, unknown>>,
  options: { redactSecrets?: boolean } = {}
): WorkflowTriggersManifest {
  const triggers = new Map<string, WorkflowTriggerDefinition>()
  for (const remote of remoteTriggers) {
    const templateId = typeof remote.templateId === 'string' ? remote.templateId : ''
    const key = typeof remote.key === 'string' ? remote.key : ''
    if (!templateId || !key) continue
    const existing = triggers.get(templateId) ?? { templateId, key, versions: [] }
    const version = toVersion(remote)
    existing.versions.push(options.redactSecrets === false ? version : redactWorkflowHeaders(version))
    triggers.set(templateId, existing)
  }
  return {
    schemaVersion: 1,
    appId,
    triggers: [...triggers.values()]
      .map(trigger => ({ ...trigger, versions: trigger.versions.sort(compareVersions) }))
      .sort((left, right) => left.key.localeCompare(right.key))
  }
}

export function createEmptyWorkflowTriggersManifest(appId: string): WorkflowTriggersManifest {
  return { schemaVersion: 1, appId, triggers: [] }
}

export function createWorkflowTriggerScaffold(name: string, key: string): WorkflowTriggerDefinition {
  return {
    key,
    versions: [
      {
        version: '1.0',
        status: 'draft',
        info: { name },
        filters: [],
        customVars: [],
        customVarsJson: {}
      }
    ]
  }
}

export function toWorkflowTriggerUpdateBody(
  desired: WorkflowTriggerVersion,
  current?: WorkflowTriggerVersion,
  environment: NodeJS.ProcessEnv = process.env
): WorkflowTriggerUpdateBody {
  const { version: _version, ...body } = clone(desired)
  const currentBody = current ? clone(current) : undefined
  hydrateWorkflowHeaders(body, currentBody, environment, 'trigger')
  if (body.customVarsJson !== undefined) {
    ;(body as Record<string, unknown>).sampleResponseJson = clone(body.customVarsJson)
  }
  return body
}

export function redactWorkflowTriggerVersion(version: WorkflowTriggerVersion): WorkflowTriggerVersion {
  return redactWorkflowHeaders(toVersion(version as unknown as Record<string, unknown>))
}
