import { isRecord } from '../../api/response.js'
import { hydrateWorkflowHeaders, redactWorkflowHeaders } from '../shared/nested-headers.js'

export type WorkflowActionStatus = 'draft' | 'in_review' | 'published'
export type WorkflowActionExecutionType = 'API' | 'CODE'
export type WorkflowActionHttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
export type WorkflowActionPayloadType = 'custom' | 'default'

export interface WorkflowActionInfo {
  name: string
  description?: string
  summary?: string
  groupName?: string
  keywords?: string[]
  icon?: string
  screenshots?: string[]
}

export interface WorkflowActionOption {
  label: string
  value: string
  description?: string
  disabled?: boolean
  icon?: string
  iconUrl?: string
}

export interface WorkflowActionInput {
  field: string
  title: string
  required?: boolean
  fieldType: string
  helpText?: string
  placeholder?: string
  validations?: Array<{ rule: string; errorMessage: string }>
  value?: unknown
  options?: WorkflowActionOption[]
  mappedTo?: string
  fetchOptions?: Record<string, unknown>
  hasDynamicOptions?: boolean
  dynamicSource?: Record<string, unknown>
  dynamicFieldsConfig?: Record<string, unknown>
  altersDynamicField?: boolean
  allowCustomInputPicker?: boolean
  customInputHelperText?: string
  eventListeners?: string[]
  resetValue?: boolean
  sortOptions?: boolean
  order?: number
  disabled?: boolean
  dependentFilters?: string[]
  showOperator?: boolean
  useArrayToArrayComparison?: boolean
  config?: Record<string, unknown>
  showHelpTextAsInfoToolTip?: boolean
  disableDatesFunction?: string
  postProcessor?: string
  showBelowCustomField?: boolean
  fieldOptions?: Record<string, unknown>
  timezoneSourceField?: string
  hideAIToggle?: boolean
  variant?: 'standard' | 'tile-picker'
  variantConfig?: Record<string, unknown>
  group?: string
  groupDivider?: boolean
  translationKey?: string
}

export interface WorkflowActionCustomVariable {
  name: string
  reference: string
  fieldType: string
  options?: WorkflowActionOption[]
  fetchOptions?: Record<string, unknown>
}

export interface WorkflowActionExecutionConfig {
  type: WorkflowActionExecutionType
  url?: string
  method?: WorkflowActionHttpMethod
  headers?: Record<string, string>
  code?: string
  pauseExecution?: boolean
}

export interface WorkflowActionBranchField {
  field: string
  title: string
  required?: boolean
  fieldType: string
  options?: WorkflowActionOption[]
  mappedTo?: string
  altersDynamicField?: boolean
  disabled?: boolean
  placeholder?: string
  helpText?: string
  value?: string
  sortOptions?: boolean
}

export interface WorkflowActionBranch {
  id: string
  branchName: string
  conditionType: 'default' | 'user-defined'
  fields?: Record<string, unknown>
  meta?: Record<string, unknown>
}

export interface WorkflowActionBranchesConfig {
  allowMultipath?: boolean
  altersDynamicField?: boolean
  info?: {
    branchNameLabel?: string
    branchNameHelpText?: string
    branchNamePlaceholder?: string
    sectionTitle?: string
    sectionDescription?: string
    deleteAlertTitle?: string
    deleteAlertDescription?: string
    addButtonLabel?: string
    allowNewCondition?: boolean
    isDefaultBranchEditable?: boolean
    showBranchSection?: boolean
  }
  fields?: WorkflowActionBranchField[]
  predefinedBranches?: {
    fetchBranches?: Record<string, unknown>
    customGenerator?: string
    branches?: WorkflowActionBranch[]
  }
  branchFieldsGenerator?: string
}

export interface WorkflowActionVersion {
  version: string
  status: WorkflowActionStatus
  info: WorkflowActionInfo
  inputs?: WorkflowActionInput[]
  customVars?: WorkflowActionCustomVariable[]
  customVarsJson?: Record<string, unknown>
  executionConfig?: WorkflowActionExecutionConfig
  payloadCustomizationType?: WorkflowActionPayloadType
  customizedPayload?: Record<string, unknown>
  branchesConfig?: WorkflowActionBranchesConfig
  sectionOrder?: string[]
  groupConfigs?: Record<string, { dividerPosition?: 'none' | 'above' | 'below' }>
}

export interface WorkflowActionDefinition {
  templateId?: string
  key: string
  versions: WorkflowActionVersion[]
}

export interface WorkflowActionsManifest {
  schemaVersion: 1
  appId: string
  actions: WorkflowActionDefinition[]
}

export type WorkflowActionUpdateBody = Omit<WorkflowActionVersion, 'version'>

const INPUT_FIELDS = [
  'field',
  'title',
  'required',
  'fieldType',
  'helpText',
  'placeholder',
  'validations',
  'value',
  'options',
  'mappedTo',
  'fetchOptions',
  'hasDynamicOptions',
  'dynamicSource',
  'dynamicFieldsConfig',
  'altersDynamicField',
  'allowCustomInputPicker',
  'customInputHelperText',
  'eventListeners',
  'resetValue',
  'sortOptions',
  'order',
  'disabled',
  'dependentFilters',
  'showOperator',
  'useArrayToArrayComparison',
  'config',
  'showHelpTextAsInfoToolTip',
  'disableDatesFunction',
  'postProcessor',
  'showBelowCustomField',
  'fieldOptions',
  'timezoneSourceField',
  'hideAIToggle',
  'variant',
  'variantConfig',
  'group',
  'groupDivider',
  'translationKey'
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

function toInput(value: unknown): WorkflowActionInput | undefined {
  if (!isRecord(value)) return undefined
  return copyKnown(value, INPUT_FIELDS) as unknown as WorkflowActionInput
}

function toInfo(value: unknown, fallbackName = ''): WorkflowActionInfo {
  const source = isRecord(value) ? value : {}
  return copyKnown(
    { ...source, name: typeof source.name === 'string' ? source.name : fallbackName },
    ['name', 'description', 'summary', 'groupName', 'keywords', 'icon', 'screenshots']
  ) as unknown as WorkflowActionInfo
}

function toExecutionConfig(value: unknown): WorkflowActionExecutionConfig | undefined {
  if (!isRecord(value)) return undefined
  const config = copyKnown(value, ['type', 'url', 'method', 'headers', 'code', 'pauseExecution'])
  if (config.type === undefined && typeof config.url === 'string' && config.url) config.type = 'API'
  if (config.type === 'API') {
    delete config.code
    if (Array.isArray(config.headers) && config.headers.length === 0) delete config.headers
    if (config.method === undefined) config.method = 'POST'
  } else if (config.type === 'CODE') {
    delete config.url
    delete config.method
    delete config.headers
  }
  return config as unknown as WorkflowActionExecutionConfig
}

function toVersion(remote: Record<string, unknown>, redactSecrets: boolean): WorkflowActionVersion {
  const result: WorkflowActionVersion = {
    version: String(remote.version ?? ''),
    status: String(remote.status ?? 'draft') as WorkflowActionStatus,
    info: toInfo(remote.info, typeof remote.name === 'string' ? remote.name : '')
  }
  if (Array.isArray(remote.inputs)) {
    result.inputs = remote.inputs
      .map(toInput)
      .filter((input): input is WorkflowActionInput => input !== undefined)
  }
  if (Array.isArray(remote.customVars)) result.customVars = clone(remote.customVars) as WorkflowActionCustomVariable[]
  if (isRecord(remote.customVarsJson)) result.customVarsJson = clone(remote.customVarsJson)
  const executionConfig = toExecutionConfig(remote.executionConfig)
  if (executionConfig) result.executionConfig = executionConfig
  if (executionConfig?.type !== 'CODE') {
    if (remote.payloadCustomizationType !== undefined) {
      result.payloadCustomizationType = remote.payloadCustomizationType as WorkflowActionPayloadType
    }
    if (isRecord(remote.customizedPayload)) result.customizedPayload = clone(remote.customizedPayload)
  }
  if (isRecord(remote.branchesConfig)) {
    result.branchesConfig = clone(remote.branchesConfig) as WorkflowActionBranchesConfig
  }
  if (Array.isArray(remote.sectionOrder)) result.sectionOrder = clone(remote.sectionOrder) as string[]
  if (isRecord(remote.groupConfigs)) {
    result.groupConfigs = clone(remote.groupConfigs) as WorkflowActionVersion['groupConfigs']
  }
  return redactSecrets ? redactWorkflowHeaders(result) : result
}

function compareVersions(left: WorkflowActionVersion, right: WorkflowActionVersion): number {
  const leftNumber = Number.parseFloat(left.version)
  const rightNumber = Number.parseFloat(right.version)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return rightNumber - leftNumber
  }
  return right.version.localeCompare(left.version)
}

export function buildWorkflowActionsManifest(
  appId: string,
  remoteActions: Array<Record<string, unknown>>,
  options: { redactSecrets?: boolean } = {}
): WorkflowActionsManifest {
  const redactSecrets = options.redactSecrets !== false
  const actions = new Map<string, WorkflowActionDefinition>()
  for (const remote of remoteActions) {
    const templateId = typeof remote.templateId === 'string' ? remote.templateId : ''
    const key = typeof remote.key === 'string' ? remote.key : ''
    if (!templateId || !key) continue
    const existing = actions.get(templateId) ?? { templateId, key, versions: [] }
    existing.versions.push(toVersion(remote, redactSecrets))
    actions.set(templateId, existing)
  }
  return {
    schemaVersion: 1,
    appId,
    actions: [...actions.values()]
      .map(action => ({ ...action, versions: action.versions.sort(compareVersions) }))
      .sort((left, right) => left.key.localeCompare(right.key))
  }
}

export function createEmptyWorkflowActionsManifest(appId: string): WorkflowActionsManifest {
  return { schemaVersion: 1, appId, actions: [] }
}

export function createWorkflowActionScaffold(name: string, key: string): WorkflowActionDefinition {
  return {
    key,
    versions: [{
      version: '1.0',
      status: 'draft',
      info: { name },
      inputs: [],
      customVars: [],
      customVarsJson: {},
      payloadCustomizationType: 'default',
      customizedPayload: {},
      branchesConfig: {}
    }]
  }
}

export function toWorkflowActionUpdateBody(
  desired: WorkflowActionVersion,
  current?: WorkflowActionVersion,
  environment: NodeJS.ProcessEnv = process.env
): WorkflowActionUpdateBody {
  const normalizedDesired = toVersion(desired as unknown as Record<string, unknown>, false)
  const { version: _version, ...body } = normalizedDesired
  const currentBody = current
    ? toVersion(current as unknown as Record<string, unknown>, false)
    : undefined
  hydrateWorkflowHeaders(body, currentBody, environment, 'action')
  return body
}

export function redactWorkflowActionVersion(version: WorkflowActionVersion): WorkflowActionVersion {
  return toVersion(version as unknown as Record<string, unknown>, true)
}
