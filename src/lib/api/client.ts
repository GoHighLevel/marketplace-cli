import { CliConfig } from '../config/environment.js'
import { isRecord, readApiResponse } from './response.js'
import { CLI_VERSION_HEADERS } from './version-header.js'
import { isExpired, loadActiveSession, refreshSession } from '../auth/session.js'
import { saveProfile, StoredProfile } from '../auth/token-store.js'
import { isDeveloperTeamId } from '../shared/validation.js'

export { isDeveloperTeamId } from '../shared/validation.js'

export interface AppListItem {
  _id: string
  appId?: string
  name: string
  status?: string
  version?: string
  private?: boolean
  createdAt?: string
  isPending?: boolean
  agencyInstallCount?: number
}

export interface SandboxAccount {
  _id?: string
  name?: string
  companyId?: string
  relationshipNumber?: string
  expiryDate?: string
  status?: string
}

export interface SandboxAccountsResponse {
  accounts: SandboxAccount[]
  apps: Record<string, string[]>
}

export interface AppListResponse {
  apps: AppListItem[]
  totalCount: number
}

export interface DeveloperTeam {
  team: string
  name?: string
  role?: string
}

const DEVELOPER_TEAM_ROLE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export interface CreateAppRequestBody {
  name: string
  private: boolean
  userTypes: string[]
  isWhiteLabelFriendly: boolean
  isAgencyBulkInstallEnabled: boolean
}

export interface CreatedApp {
  _id: string
  appId?: string
  name: string
}

export interface SupportConfig {
  supportEmail?: string
  supportPhone?: string
  websiteUrl?: string
  documentationUrl?: string
  termsAndConditionsUrl?: string
  privacyPolicyUrl?: string
  supportedServices?: string[]
}

export interface AppVersion {
  _id: string
  appId?: string
  createdAt?: string
  name?: string
  version?: string
  status?: string
  private?: boolean
  appType?: string
  billingType?: 'free' | 'paid' | 'freemium'
  isPaidApp?: boolean
  isFreemium?: boolean
  externalBilling?: boolean
  externalBillingUrl?: string
  hasFreeTrial?: boolean
  freeTrialDuration?: number
  hasUsageBasedPrice?: boolean
  paymentType?: string
  oneTimePrice?: number
  additionalInfoForBilling?: string
  tagline?: string
  companyName?: string
  contact?: { email?: string; name?: string }
  website?: string
  category?: string
  subcategory?: string[]
  businessNiche?: string[]
  logoUrl?: string
  userTypes?: string[]
  isWhiteLabelFriendly?: boolean
  isAgencyBulkInstallEnabled?: boolean
  searchKeywords?: string[]
  description?: string
  previewImageUrls?: string[]
  previewVideoUrl?: string
  hasSubAccountProfile?: boolean
  subAccountDescription?: string
  subAccountPreviewImageUrls?: string[]
  subAccountPreviewVideoUrl?: string
  supportConfig?: SupportConfig
  allowedScopes?: string[]
  redirectUris?: string[]
  clientKeys?: Array<{ id?: string; name?: string; deleted?: boolean; isDefault?: boolean; default?: boolean }>
  defaults?: { clientKey?: string; redirectUrl?: string }
  hasExternalAuth?: boolean
  externalConfig?: Record<string, unknown>
  externalAuthConfig?: Record<string, unknown>
  mcpConfig?: Record<string, unknown>
  customPages?: Record<string, unknown>[]
  webhookUrl?: string
  subscribedEvents?: Array<{ name: string; url?: string; warningFlag?: boolean }>
  endToEndDemoUrl?: string
  scopesDemoUrl?: string
  testCredentials?: string
  additionalDetails?: string
  privateReason?: string
  securityReview?: { status?: string; reviewed?: boolean }
}

export interface ProfileUpdateResult {
  oAuthClient?: { _id?: string; id?: string; appId?: string }
  pendingOAuthClient?: { _id?: string; id?: string; appId?: string }
}

export interface PreSubmitValidation {
  success: boolean
  message?: string
  mandatoryFields?: Record<string, boolean>
}

export interface WebhooksCatalog {
  events?: string[]
  mapping?: Record<string, string[]>
}

export interface ClientKeyCreated {
  id: string
  secret: string
}

export interface VersionListItem {
  _id: string
  appId?: string
  name?: string
  version?: string
  status?: string
}

export interface VersionAnalysis {
  suggestedVersion?: string
  latestLiveVersion?: string | null
  updateType?: string | null
  changes?: unknown
}

export interface BillingSettings {
  billingType: 'free' | 'paid' | 'freemium'
  externalBilling?: boolean
  externalBillingUrl?: string
  hasFreeTrial?: boolean
  freeTrialDuration?: number
}

export interface BillingPlan {
  _id?: string
  id?: string
  name?: string
  features?: string[]
  price?: number | null
  locationPrice?: number | null
  isFreemiumPlan?: boolean
  freeForAgency?: boolean
  freeForLocation?: boolean
  /* Accepted for compatibility with older/transformed responses. */
  amount?: number | null
  locationAmount?: number | null
  freePlan?: boolean
  paymentType?: string
  paymentTime?: string
}

export interface BillingUsageTier {
  _id: string
  name: string
  minVolume: number
  maxVolume?: number | null
  pricePerUnit: number
  minPricePerUnit?: number | null
  maxPricePerUnit?: number | null
  executionLimitPerCycle: number
}

export interface BillingUsageMeter {
  _id: string
  appId?: string
  productType: 'conversation_provider' | 'workflow_action' | 'workflow_trigger' | 'custom'
  productId: string
  productName: string
  customPriceType: 'fixed' | 'dynamic'
  usageUnit: string
  direction?: 'inbound' | 'outbound'
  pricingPageURL?: string
  billingTier: BillingUsageTier[]
}

export interface WorkflowActionSummary {
  _id: string
  actionId: string
  name: string
  version: string
  status: string
  isHidden?: boolean
  isActive?: boolean
}

export interface WorkflowActionConfig extends Record<string, unknown> {
  templateId: string
  appId: string
  key: string
  version: string
  status: string
  info: { name: string; [key: string]: unknown }
}

export interface WorkflowTriggerSummary {
  _id: string
  triggerId: string
  name: string
  version: string
  status?: string
  isActive?: boolean
}

export interface WorkflowTriggerConfig extends Record<string, unknown> {
  templateId: string
  appId: string
  key: string
  version: string
  status: string
  info: { name: string; [key: string]: unknown }
}

export interface WorkflowActionTestRequest {
  appId: string
  inputData: Record<string, unknown>
  locationId?: string
  executionConfig: {
    type: 'API' | 'CODE'
    url?: string
    method?: string
    code?: string
    headers: Array<{ label: string; key: string }>
  }
}

export interface WorkflowActionTestResponse {
  hasError: boolean
  errorMessage?: unknown
  output?: unknown
  consoleLogs?: string[]
}

interface RequestOptions {
  method?: string
  query?: Record<string, string | number | undefined>
  body?: unknown
  headers?: Record<string, string>
  /* Overrides the marketplace base URL, e.g. for oauth-service file uploads. */
  baseUrl?: string
}

function hasOptionalStringFields(value: Record<string, unknown>, fields: string[], allowNull = false): boolean {
  return fields.every(
    field => value[field] === undefined || (allowNull && value[field] === null) || typeof value[field] === 'string'
  )
}

function hasOptionalBooleanFields(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every(field => value[field] === undefined || typeof value[field] === 'boolean')
}

function hasOptionalFiniteNumberFields(
  value: Record<string, unknown>,
  fields: string[],
  allowNull = false
): boolean {
  return fields.every(field => {
    const fieldValue = value[field]
    return (
      fieldValue === undefined ||
      (allowNull && fieldValue === null) ||
      (typeof fieldValue === 'number' && Number.isFinite(fieldValue))
    )
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function hasOptionalStringArrayFields(
  value: Record<string, unknown>,
  fields: string[],
  allowNull = false
): boolean {
  return fields.every(
    field => value[field] === undefined || (allowNull && value[field] === null) || isStringArray(value[field])
  )
}

type ClientKey = NonNullable<AppVersion['clientKeys']>[number]

function normalizeClientKeys(value: unknown): ClientKey[] | undefined {
  if (!Array.isArray(value)) return undefined
  const keys: ClientKey[] = []
  for (const key of value) {
    if (
      !isRecord(key) ||
      typeof key.id !== 'string' ||
      !key.id ||
      !hasOptionalStringFields(key, ['name']) ||
      !hasOptionalBooleanFields(key, ['deleted', 'isDefault', 'default'])
    ) {
      return undefined
    }
    keys.push({
      id: key.id,
      ...(typeof key.name === 'string' ? { name: key.name } : {}),
      ...(typeof key.deleted === 'boolean' ? { deleted: key.deleted } : {}),
      ...(typeof key.isDefault === 'boolean' ? { isDefault: key.isDefault } : {}),
      ...(typeof key.default === 'boolean' ? { default: key.default } : {})
    })
  }
  return keys
}

function normalizeDefaults(value: unknown): AppVersion['defaults'] | undefined {
  if (!isRecord(value) || !hasOptionalStringFields(value, ['clientKey', 'redirectUrl'])) return undefined
  return {
    ...(typeof value.clientKey === 'string' ? { clientKey: value.clientKey } : {}),
    ...(typeof value.redirectUrl === 'string' ? { redirectUrl: value.redirectUrl } : {})
  }
}

function isAppVersion(value: unknown): value is AppVersion {
  if (!isRecord(value) || typeof value._id !== 'string' || value._id.length === 0) return false
  if (
    !hasOptionalStringFields(value, [
      'appId',
      'createdAt',
      'name',
      'version',
      'status',
      'appType',
      'externalBillingUrl',
      'paymentType',
      'additionalInfoForBilling',
      'tagline',
      'companyName',
      'website',
      'category',
      'logoUrl',
      'description',
      'previewVideoUrl',
      'subAccountDescription',
      'subAccountPreviewVideoUrl',
      'webhookUrl',
      'endToEndDemoUrl',
      'scopesDemoUrl',
      'testCredentials',
      'additionalDetails',
      'privateReason'
    ], true) ||
    !hasOptionalBooleanFields(value, [
      'private',
      'externalBilling',
      'isPaidApp',
      'isFreemium',
      'hasFreeTrial',
      'hasUsageBasedPrice',
      'hasExternalAuth',
      'isWhiteLabelFriendly',
      'isAgencyBulkInstallEnabled',
      'hasSubAccountProfile'
    ]) ||
    !hasOptionalFiniteNumberFields(value, ['freeTrialDuration', 'oneTimePrice'], true) ||
    !hasOptionalStringArrayFields(value, [
      'subcategory',
      'businessNiche',
      'userTypes',
      'searchKeywords',
      'previewImageUrls',
      'subAccountPreviewImageUrls',
      'allowedScopes',
      'redirectUris'
    ], true) ||
    (value.billingType !== undefined &&
      value.billingType !== null &&
      !['free', 'paid', 'freemium'].includes(String(value.billingType)))
  ) {
    return false
  }

  if (
    value.contact !== undefined &&
    value.contact !== null &&
    (!isRecord(value.contact) || !hasOptionalStringFields(value.contact, ['email', 'name']))
  ) {
    return false
  }

  for (const field of ['externalConfig', 'externalAuthConfig', 'mcpConfig'] as const) {
    if (value[field] !== undefined && value[field] !== null && !isRecord(value[field])) return false
  }
  if (
    value.customPages !== undefined &&
    value.customPages !== null &&
    (!Array.isArray(value.customPages) || !value.customPages.every(page => isRecord(page)))
  ) {
    return false
  }

  if (value.supportConfig !== undefined && value.supportConfig !== null) {
    if (
      !isRecord(value.supportConfig) ||
      !hasOptionalStringFields(value.supportConfig, [
        'supportEmail',
        'supportPhone',
        'websiteUrl',
        'documentationUrl',
        'termsAndConditionsUrl',
        'privacyPolicyUrl'
      ]) ||
      (value.supportConfig.supportedServices !== undefined &&
        !isStringArray(value.supportConfig.supportedServices))
    ) {
      return false
    }
  }

  if (
    value.clientKeys !== undefined &&
    value.clientKeys !== null &&
    normalizeClientKeys(value.clientKeys) === undefined
  ) {
    return false
  }

  if (value.defaults !== undefined && value.defaults !== null && normalizeDefaults(value.defaults) === undefined) {
    return false
  }

  if (
    value.securityReview !== undefined &&
    value.securityReview !== null &&
    (!isRecord(value.securityReview) ||
      !hasOptionalStringFields(value.securityReview, ['status']) ||
      !hasOptionalBooleanFields(value.securityReview, ['reviewed']))
  ) {
    return false
  }

  return (
    value.subscribedEvents === undefined ||
    value.subscribedEvents === null ||
    (Array.isArray(value.subscribedEvents) &&
      value.subscribedEvents.every(
        event =>
          isRecord(event) &&
          typeof event.name === 'string' &&
          event.name.length > 0 &&
          hasOptionalStringFields(event, ['url']) &&
          hasOptionalBooleanFields(event, ['warningFlag'])
      ))
  )
}

function normalizeAppVersion(value: unknown): AppVersion | undefined {
  if (!isAppVersion(value)) return undefined
  const record = value as AppVersion & Record<string, unknown>
  const nestedValue = record.oAuthClient
  const nested = nestedValue == null ? [] : Array.isArray(nestedValue) ? nestedValue : [nestedValue]
  if (
    nested.some(
      source =>
        !isRecord(source) ||
        (source.clientKeys != null && normalizeClientKeys(source.clientKeys) === undefined) ||
        (source.defaults != null && normalizeDefaults(source.defaults) === undefined) ||
        (source.redirectUris != null && !isStringArray(source.redirectUris))
    )
  ) {
    return undefined
  }

  const sources = nested as Record<string, unknown>[]
  const keys = [...(normalizeClientKeys(value.clientKeys) ?? [])]
  const seen = new Set(keys.map(key => key.id))
  for (const source of sources) {
    for (const key of normalizeClientKeys(source.clientKeys) ?? []) {
      if (!seen.has(key.id)) {
        keys.push(key)
        seen.add(key.id)
      }
    }
  }

  const nestedDefaults = sources.map(source => normalizeDefaults(source.defaults)).find(Boolean)
  const defaults = nestedDefaults ?? normalizeDefaults(value.defaults)
  const redirectsSource = sources.find(source => source.redirectUris != null)
  const { oAuthClient: _oAuthClient, ...rawBase } = record
  const base = Object.fromEntries(Object.entries(rawBase).filter(([, field]) => field !== null))
  const legacyBillingType =
    value.isPaidApp === undefined ? undefined : value.isPaidApp ? (value.isFreemium ? 'freemium' : 'paid') : 'free'
  const billingType = value.billingType ?? legacyBillingType
  return {
    ...base,
    ...(billingType ? { billingType } : {}),
    ...(keys.length > 0 || value.clientKeys !== undefined ? { clientKeys: keys } : {}),
    ...(defaults ? { defaults } : {}),
    ...(redirectsSource ? { redirectUris: redirectsSource.redirectUris as string[] } : {})
  } as AppVersion
}

function isBillingPlan(value: unknown): value is BillingPlan {
  if (!isRecord(value)) return false
  const id = value._id ?? value.id
  const amount = value.price ?? value.amount
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    Array.isArray(value.features) &&
    value.features.every(feature => typeof feature === 'string') &&
    ['month', 'year', 'life_time'].includes(String(value.paymentTime)) &&
    ['recurring', 'one_time'].includes(String(value.paymentType)) &&
    typeof amount === 'number' &&
    Number.isFinite(amount) &&
    hasOptionalStringFields(value, ['_id', 'id', 'name', 'paymentType', 'paymentTime']) &&
    hasOptionalFiniteNumberFields(value, ['price', 'locationPrice', 'amount', 'locationAmount'], true) &&
    hasOptionalBooleanFields(value, [
      'isFreemiumPlan',
      'freeForAgency',
      'freeForLocation',
      'freePlan'
    ])
  )
}

function isBillingUsageTier(value: unknown): value is BillingUsageTier {
  return (
    isRecord(value) &&
    typeof value._id === 'string' &&
    value._id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.minVolume === 'number' &&
    Number.isFinite(value.minVolume) &&
    (value.maxVolume === undefined || value.maxVolume === null ||
      (typeof value.maxVolume === 'number' && Number.isFinite(value.maxVolume))) &&
    typeof value.pricePerUnit === 'number' &&
    Number.isFinite(value.pricePerUnit) &&
    hasOptionalFiniteNumberFields(value, ['minPricePerUnit', 'maxPricePerUnit'], true) &&
    typeof value.executionLimitPerCycle === 'number' &&
    Number.isFinite(value.executionLimitPerCycle)
  )
}

function isBillingUsageMeter(value: unknown): value is BillingUsageMeter {
  return (
    isRecord(value) &&
    typeof value._id === 'string' &&
    value._id.length > 0 &&
    hasOptionalStringFields(value, ['appId', 'pricingPageURL']) &&
    ['conversation_provider', 'workflow_action', 'workflow_trigger', 'custom'].includes(String(value.productType)) &&
    typeof value.productId === 'string' &&
    value.productId.trim().length > 0 &&
    typeof value.productName === 'string' &&
    value.productName.trim().length > 0 &&
    ['fixed', 'dynamic'].includes(String(value.customPriceType)) &&
    typeof value.usageUnit === 'string' &&
    value.usageUnit.trim().length > 0 &&
    (value.direction === undefined || ['inbound', 'outbound'].includes(String(value.direction))) &&
    Array.isArray(value.billingTier) &&
    value.billingTier.every(isBillingUsageTier)
  )
}

function isWorkflowActionSummary(value: unknown): value is WorkflowActionSummary {
  return (
    isRecord(value) &&
    typeof value._id === 'string' &&
    value._id.length > 0 &&
    typeof value.actionId === 'string' &&
    value.actionId.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.status === 'string' &&
    value.status.length > 0 &&
    hasOptionalBooleanFields(value, ['isHidden', 'isActive'])
  )
}

function isWorkflowActionConfig(value: unknown): value is WorkflowActionConfig {
  return (
    isRecord(value) &&
    typeof value.templateId === 'string' &&
    value.templateId.length > 0 &&
    typeof value.appId === 'string' &&
    value.appId.length > 0 &&
    typeof value.key === 'string' &&
    value.key.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.status === 'string' &&
    value.status.length > 0 &&
    isRecord(value.info) &&
    typeof value.info.name === 'string' &&
    value.info.name.trim().length > 0
  )
}

function isWorkflowTriggerSummary(value: unknown): value is WorkflowTriggerSummary {
  return (
    isRecord(value) &&
    typeof value._id === 'string' &&
    value._id.length > 0 &&
    typeof value.triggerId === 'string' &&
    value.triggerId.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    hasOptionalStringFields(value, ['status']) &&
    hasOptionalBooleanFields(value, ['isActive'])
  )
}

function isWorkflowTriggerConfig(value: unknown): value is WorkflowTriggerConfig {
  return (
    isRecord(value) &&
    typeof value.templateId === 'string' &&
    value.templateId.length > 0 &&
    typeof value.appId === 'string' &&
    value.appId.length > 0 &&
    typeof value.key === 'string' &&
    value.key.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.status === 'string' &&
    value.status.length > 0 &&
    isRecord(value.info) &&
    typeof value.info.name === 'string' &&
    value.info.name.trim().length > 0
  )
}

function workflowActionConfigs(response: unknown, label: string): WorkflowActionConfig[] {
  if (!isRecord(response) || !Array.isArray(response.actions) || !response.actions.every(isWorkflowActionConfig)) {
    throw new Error(`${label} API returned an unexpected response.`)
  }
  return response.actions
}

function workflowTriggerConfigs(response: unknown, label: string): WorkflowTriggerConfig[] {
  if (!isRecord(response) || !Array.isArray(response.triggers) || !response.triggers.every(isWorkflowTriggerConfig)) {
    throw new Error(`${label} API returned an unexpected response.`)
  }
  return response.triggers
}

async function recoverCreatedWorkflowVersion<T>(
  loadConfigs: () => Promise<Array<WorkflowActionConfig | WorkflowTriggerConfig>>,
  templateId: string,
  toSummary: (draft: WorkflowActionConfig | WorkflowTriggerConfig) => T
): Promise<T | undefined> {
  try {
    const draft = (await loadConfigs()).find(
      config => config.templateId === templateId && config.status.toLowerCase() === 'draft'
    )
    return draft ? toSummary(draft) : undefined
  } catch {
    return undefined
  }
}

function workflowActionTestResponse(response: unknown): WorkflowActionTestResponse {
  if (
    !isRecord(response) ||
    typeof response.hasError !== 'boolean' ||
    (response.consoleLogs !== undefined && !isStringArray(response.consoleLogs)) ||
    (!response.hasError && !Object.hasOwn(response, 'output'))
  ) {
    throw new Error('Workflow action test API returned an unexpected response.')
  }
  return response as unknown as WorkflowActionTestResponse
}

function validateProfileUpdateResponse(response: unknown, label: string): ProfileUpdateResult {
  if (!isRecord(response)) throw new Error(`${label} API returned an unexpected response.`)
  const result: ProfileUpdateResult = {}
  for (const field of ['oAuthClient', 'pendingOAuthClient'] as const) {
    const document = response[field]
    if (document === undefined) continue
    if (
      !isRecord(document) ||
      !hasOptionalStringFields(document, ['_id', 'id', 'appId']) ||
      ![document._id, document.id].some(id => typeof id === 'string' && id.length > 0)
    ) {
      throw new Error(`${label} API returned an unexpected response.`)
    }
    result[field] = document
  }
  if (!result.oAuthClient && !result.pendingOAuthClient) {
    throw new Error(`${label} API returned an unexpected response.`)
  }
  return result
}

export class ApiClient {
  private profileName = ''
  private profile!: StoredProfile
  private refreshPromise?: Promise<StoredProfile>

  constructor(private readonly config: CliConfig) {}

  get activeProfileName(): string {
    return this.profileName
  }

  get activeTeamId(): string | undefined {
    return this.profile.teamId
  }

  get activeTeamName(): string | undefined {
    return this.profile.teamName
  }

  async init(): Promise<void> {
    const session = await loadActiveSession(this.config)
    this.profileName = session.name
    this.profile = session.profile
    if (isExpired(this.profile.accessToken, this.profile.expiresAt)) {
      await this.refreshProfile()
    }
  }

  /* Concurrent requests share token rotation so a single-use refresh token
     is never submitted more than once by the same client. */
  private async refreshProfile(): Promise<void> {
    const operation = this.refreshPromise ??= refreshSession(this.config, this.profileName, this.profile)
    try {
      this.profile = await operation
    } finally {
      if (this.refreshPromise === operation) this.refreshPromise = undefined
    }
  }

  private headers(json = true, additional: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      ...CLI_VERSION_HEADERS,
      authorization: `Bearer ${this.profile.accessToken}`,
      channel: 'APP',
      source: 'DEVELOPER_WEB_USER',
      version: '2023-02-21'
    }
    if (json) headers['content-type'] = 'application/json'
    if (this.profile.teamId) headers.teamid = this.profile.teamId
    return { ...additional, ...headers }
  }

  /* On 401 the token is refreshed once and the request retried;
     a second 401 surfaces as a login error. */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (isExpired(this.profile.accessToken, this.profile.expiresAt)) {
      await this.refreshProfile()
    }
    const url = new URL(`${options.baseUrl ?? this.config.apiUrl}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }

    const isForm = options.body instanceof FormData
    const init = (): { method: string; headers: Record<string, string>; body?: string | FormData } => ({
      method: options.method ?? 'GET',
      headers: this.headers(!isForm, options.headers),
      ...(options.body !== undefined
        ? { body: isForm ? (options.body as FormData) : JSON.stringify(options.body) }
        : {})
    })

    const doFetch = async (): Promise<Response> => {
      try {
        return await fetch(url, init())
      } catch {
        const target = options.baseUrl ?? this.config.apiUrl
        const override = target === this.config.oauthUrl
          ? 'GHL_OAUTH_URL'
          : target === this.config.workflowsUrl
            ? 'GHL_WORKFLOWS_URL'
            : 'GHL_API_URL'
        throw new Error(`Cannot reach ${url.origin}. Check your network connection or the ${override} setting.`)
      }
    }

    const requestToken = this.profile.accessToken
    let res = await doFetch()
    if (res.status === 401) {
      if (this.profile.accessToken === requestToken) await this.refreshProfile()
      res = await doFetch()
    }
    if (res.status === 401) throw new Error('Session expired. Run `ghl login` again.')
    return (await readApiResponse(res, {
      failureLabel: 'API request failed',
      responseLabel: 'API request'
    })) as T
  }

  async listDeveloperTeams(): Promise<DeveloperTeam[]> {
    const response = await this.request<unknown>('/users/teams')
    if (!Array.isArray(response)) throw new Error('Developer teams API returned an unexpected response.')
    if (!response.every(team =>
      isRecord(team) &&
      isDeveloperTeamId(team.team) &&
      (team.name === undefined || typeof team.name === 'string') &&
      (team.role === undefined || (typeof team.role === 'string' && DEVELOPER_TEAM_ROLE.test(team.role)))
    )) {
      throw new Error('Developer teams API returned an unexpected response.')
    }
    return response as DeveloperTeam[]
  }

  async selectDeveloperTeam(teamId: string, memberships?: DeveloperTeam[]): Promise<DeveloperTeam> {
    if (!isDeveloperTeamId(teamId)) {
      throw new Error('Account id must contain 1-128 letters, numbers, underscores, or hyphens.')
    }
    const teams = memberships ?? await this.listDeveloperTeams()
    const selected = teams.find(membership => membership.team === teamId)
    if (!selected) {
      throw new Error(`Account ${JSON.stringify(teamId)} is not available to this developer. Run \`ghl account\` to list accessible accounts.`)
    }
    const nextProfile = { ...this.profile, teamId: selected.team }
    if (selected.name) nextProfile.teamName = selected.name
    else delete nextProfile.teamName
    await saveProfile(this.config.configDir, this.profileName, nextProfile)
    this.profile = nextProfile
    return selected
  }

  /* Apps in the portal are owned by the developer's team, so the teamid
     header is resolved once and cached in the profile. */
  async ensureTeam(memberships?: DeveloperTeam[]): Promise<void> {
    if (this.profile.teamId && (!memberships || memberships.some(team => team.team === this.profile.teamId))) return
    const teams = memberships ?? await this.listDeveloperTeams()
    if (teams.length === 0) {
      throw new Error('No developer account is available. Ask an account owner to add you, then retry.')
    }
    const own = teams.find(membership => membership.role?.toUpperCase() === 'OWNER') ?? teams[0]
    await this.selectDeveloperTeam(own.team, teams)
  }

  async listApps(options: { skip?: number; limit?: number; search?: string }): Promise<AppListResponse> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/app', {
      query: { skip: options.skip ?? 0, limit: options.limit ?? 50, nameSearch: options.search }
    })
    if (
      !isRecord(response) ||
      !Array.isArray(response.apps) ||
      typeof response.totalCount !== 'number' ||
      !Number.isInteger(response.totalCount) ||
      response.totalCount < 0 ||
      !response.apps.every(
        app =>
          isRecord(app) &&
          typeof app._id === 'string' &&
          app._id.length > 0 &&
          typeof app.name === 'string' &&
          app.name.trim().length > 0 &&
          hasOptionalStringFields(app, ['appId', 'status', 'version', 'createdAt']) &&
          (app.appId === undefined || (typeof app.appId === 'string' && app.appId.length > 0)) &&
          (app.private === undefined || typeof app.private === 'boolean') &&
          (app.isPending === undefined || typeof app.isPending === 'boolean') &&
          (app.agencyInstallCount === undefined ||
            (typeof app.agencyInstallCount === 'number' &&
              Number.isInteger(app.agencyInstallCount) &&
              app.agencyInstallCount >= 0))
      )
    ) {
      throw new Error('App list API returned an unexpected response.')
    }
    return response as unknown as AppListResponse
  }

  async createApp(body: CreateAppRequestBody): Promise<CreatedApp> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/app', { method: 'POST', body })
    if (
      !isRecord(response) ||
      typeof response._id !== 'string' ||
      !response._id ||
      typeof response.name !== 'string' ||
      !response.name.trim() ||
      (response.appId !== undefined && (typeof response.appId !== 'string' || !response.appId))
    ) {
      throw new Error('Create app API returned an unexpected response. The app may still have been created; run `ghl app list`.')
    }
    return response as unknown as CreatedApp
  }

  async getVersion(appId: string, versionId: string): Promise<AppVersion> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/${appId}/versions/${versionId}`)
    const version = normalizeAppVersion(response)
    if (!version) throw new Error('App version API returned an unexpected response.')
    return version
  }

  async getLatestVersion(appId: string, live = false): Promise<AppVersion> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/${appId}/versions/latest`, {
      query: { isLive: live ? 'true' : undefined }
    })
    const version = normalizeAppVersion(response)
    if (!version) throw new Error('Latest app version API returned an unexpected response.')
    return version
  }

  async preSubmitValidation(appId: string, versionId: string): Promise<PreSubmitValidation> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/${appId}/${versionId}/pre-submit-validation`)
    if (
      !isRecord(response) ||
      typeof response.success !== 'boolean' ||
      (response.message !== undefined && typeof response.message !== 'string') ||
      (response.mandatoryFields !== undefined &&
        (!isRecord(response.mandatoryFields) ||
          !Object.values(response.mandatoryFields).every(value => typeof value === 'boolean')))
    ) {
      throw new Error('Pre-submit validation API returned an unexpected response.')
    }
    return response as unknown as PreSubmitValidation
  }

  async updateProfileSection(
    section: 'basicInfo' | 'listingConfiguration' | 'appProfiles' | 'supportDetails',
    appId: string,
    versionId: string,
    body: unknown
  ): Promise<ProfileUpdateResult> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/profile/${appId}/versions/${versionId}/${section}`, {
      method: 'PUT',
      body
    })
    return validateProfileUpdateResponse(response, 'Profile update')
  }

  /* App-review details (demo URLs, test credentials) required before a
     public app can be submitted for marketplace review. */
  async updateReviewDetails(appId: string, versionId: string, body: unknown): Promise<ProfileUpdateResult> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/profile/${appId}/versions/${versionId}/additionalInfo`, {
      method: 'PATCH',
      body
    })
    return validateProfileUpdateResponse(response, 'Review details update')
  }

  /* File uploads go to the oauth service, matching the portal:
     POST /oauth/clients/:appId/files with `logo` or `preview` fields. */
  async uploadFiles(appId: string, form: FormData): Promise<Record<string, string>> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/files`, {
      method: 'POST',
      body: form,
      baseUrl: this.config.oauthUrl
    })
    return normalizeUploadResponse(response)
  }

  async deleteFiles(appId: string, fileUrls: string[]): Promise<void> {
    await this.ensureTeam()
    await this.request<unknown>(`/clients/${appId}/files`, {
      method: 'DELETE',
      body: { fileUrls },
      baseUrl: this.config.oauthUrl
    })
  }

  /* Scope and webhook-event catalogs live on the oauth service. */
  async getScopesCatalog(): Promise<unknown> {
    return this.request<unknown>('/static/scopes', {
      query: { isMarketplace: 'true' },
      baseUrl: this.config.oauthUrl
    })
  }

  async getWebhooksCatalog(): Promise<WebhooksCatalog> {
    const response = await this.request<unknown>('/static/webhooks', { baseUrl: this.config.oauthUrl })
    const events = isRecord(response) && Array.isArray(response.events) ? response.events : []
    const eventNames = new Set(events)
    if (
      !isRecord(response) ||
      !Array.isArray(response.events) ||
      !response.events.every(event => typeof event === 'string' && event.length > 0) ||
      eventNames.size !== response.events.length ||
      !isRecord(response.mapping) ||
      !Object.entries(response.mapping).every(
        ([scope, mappedEvents]) =>
          scope.length > 0 &&
          Array.isArray(mappedEvents) &&
          mappedEvents.every(event => typeof event === 'string' && eventNames.has(event)) &&
          new Set(mappedEvents).size === mappedEvents.length
      )
    ) {
      throw new Error('Webhook catalog API returned an unexpected response.')
    }
    return response as WebhooksCatalog
  }

  async listWorkflowActionSummaries(appId: string): Promise<WorkflowActionSummary[]> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/actions`, { baseUrl: this.config.oauthUrl })
    if (!isRecord(response) || !Array.isArray(response.actions) || !response.actions.every(isWorkflowActionSummary)) {
      throw new Error('Workflow action registry API returned an unexpected response.')
    }
    return response.actions as WorkflowActionSummary[]
  }

  async listWorkflowActionConfigs(appId: string): Promise<WorkflowActionConfig[]> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/actions', {
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId }
    })
    return workflowActionConfigs(response, 'Workflow action list')
  }

  async getWorkflowActionConfigs(appId: string, templateId: string, version?: string): Promise<WorkflowActionConfig[]> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/actions/${templateId}`, {
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId },
      query: { version }
    })
    return workflowActionConfigs(response, 'Workflow action details')
  }

  async checkWorkflowActionKeyAvailability(appId: string, key: string): Promise<boolean> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/slugs/availability/${encodeURIComponent(key)}`, {
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId }
    })
    if (!isRecord(response) || typeof response.availability !== 'boolean') {
      throw new Error('Workflow action key availability API returned an unexpected response.')
    }
    return response.availability
  }

  async createWorkflowAction(
    appId: string,
    body: { name: string; key: string; version: string }
  ): Promise<WorkflowActionSummary> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/actions`, {
      method: 'POST',
      body,
      baseUrl: this.config.oauthUrl
    })
    if (!isRecord(response) || response.success !== true || !isWorkflowActionSummary(response.action)) {
      throw new Error(
        'Create workflow action API returned an unexpected response. The action may still have been created; run `ghl app actions pull`.'
      )
    }
    return response.action
  }

  async createWorkflowActionVersion(appId: string, templateId: string): Promise<WorkflowActionSummary> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/actions/${templateId}/new-version`, {
      method: 'POST',
      body: {},
      baseUrl: this.config.oauthUrl
    })
    if (isRecord(response) && response.success === true && isWorkflowActionSummary(response.action)) {
      return response.action
    }
    const recovered = await recoverCreatedWorkflowVersion(
      () => this.getWorkflowActionConfigs(appId, templateId),
      templateId,
      draft => ({
        _id: templateId,
        actionId: templateId,
        name: draft.info.name,
        version: draft.version,
        status: 'draft',
        isActive: false
      })
    )
    if (recovered) return recovered
    throw new Error(
      'Create workflow action version API returned an unexpected response. Run `ghl app actions pull` before retrying.'
    )
  }

  async updateWorkflowActionConfig(appId: string, templateId: string, body: unknown): Promise<void> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/actions/${templateId}`, {
      method: 'PUT',
      body,
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId }
    })
    if (!isRecord(response) || response.success !== true) {
      throw new Error('Workflow action update API returned an unexpected response. Run `ghl app actions pull` before retrying.')
    }
  }

  async updateWorkflowActionSummary(
    appId: string,
    templateId: string,
    body: { name?: string; version?: string; status?: string; isHidden?: boolean }
  ): Promise<WorkflowActionSummary> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/actions/${templateId}/update`, {
      method: 'POST',
      body,
      baseUrl: this.config.oauthUrl
    })
    if (!isRecord(response) || response.success !== true || !isWorkflowActionSummary(response.action)) {
      throw new Error('Workflow action registry update API returned an unexpected response. Run `ghl app actions pull`.')
    }
    return response.action
  }

  async deleteWorkflowAction(appId: string, templateId: string): Promise<void> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/actions/${templateId}`, {
      method: 'DELETE',
      baseUrl: this.config.oauthUrl
    })
    if (!isRecord(response) || response.success !== true) {
      throw new Error('Delete workflow action API returned an unexpected response. Run `ghl app actions pull` to verify its state.')
    }
  }

  async submitWorkflowActionForReview(
    appId: string,
    body: { id: string; type: 'Action'; version: string; releaseNotes: { user: string; reviewer: string } }
  ): Promise<void> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/releases/submit-for-review', {
      method: 'POST',
      body,
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId }
    })
    if (!isRecord(response) || response.success !== true) {
      throw new Error('Workflow action review API returned an unexpected response. Run `ghl app actions pull` to verify its state.')
    }
  }

  async publishWorkflowActionSummary(appId: string, templateId: string, version: string): Promise<void> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/actions/${templateId}/publish`, {
      method: 'POST',
      body: { version },
      baseUrl: this.config.oauthUrl
    })
    if (!isRecord(response) || response.success !== true) {
      throw new Error('Workflow action publish registry API returned an unexpected response. Run `ghl app actions pull`.')
    }
  }

  async testWorkflowAction(
    appId: string,
    body: WorkflowActionTestRequest
  ): Promise<WorkflowActionTestResponse> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/run-code-test', {
      method: 'POST',
      body,
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId }
    })
    return workflowActionTestResponse(response)
  }

  async listWorkflowTriggerSummaries(appId: string): Promise<WorkflowTriggerSummary[]> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/triggers`, { baseUrl: this.config.oauthUrl })
    if (!isRecord(response) || !Array.isArray(response.triggers) || !response.triggers.every(isWorkflowTriggerSummary)) {
      throw new Error('Workflow trigger registry API returned an unexpected response.')
    }
    return response.triggers as WorkflowTriggerSummary[]
  }

  async listWorkflowTriggerConfigs(appId: string): Promise<WorkflowTriggerConfig[]> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/triggers', {
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId }
    })
    return workflowTriggerConfigs(response, 'Workflow trigger list')
  }

  async getWorkflowTriggerConfigs(appId: string, templateId: string, version?: string): Promise<WorkflowTriggerConfig[]> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/triggers/${templateId}`, {
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId },
      query: { version }
    })
    return workflowTriggerConfigs(response, 'Workflow trigger details')
  }

  async checkWorkflowTriggerKeyAvailability(appId: string, key: string): Promise<boolean> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/slugs/availability/${encodeURIComponent(key)}`, {
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId }
    })
    if (!isRecord(response) || typeof response.availability !== 'boolean') {
      throw new Error('Workflow trigger key availability API returned an unexpected response.')
    }
    return response.availability
  }

  async createWorkflowTrigger(
    appId: string,
    body: { name: string; key: string; version: string }
  ): Promise<WorkflowTriggerSummary> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/triggers`, {
      method: 'POST',
      body,
      baseUrl: this.config.oauthUrl
    })
    if (!isRecord(response) || response.success !== true || !isRecord(response.trigger) || !isWorkflowTriggerSummary(response.trigger)) {
      throw new Error(
        'Create workflow trigger API returned an unexpected response. The trigger may still have been created; run `ghl app triggers pull`.'
      )
    }
    return response.trigger
  }

  async createWorkflowTriggerVersion(appId: string, templateId: string): Promise<WorkflowTriggerSummary> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/triggers/${templateId}/new-version`, {
      method: 'POST',
      body: {},
      baseUrl: this.config.oauthUrl
    })
    if (isRecord(response) && response.success === true && isRecord(response.trigger) && isWorkflowTriggerSummary(response.trigger)) {
      return response.trigger
    }
    const recovered = await recoverCreatedWorkflowVersion(
      () => this.getWorkflowTriggerConfigs(appId, templateId),
      templateId,
      draft => ({
        _id: templateId,
        triggerId: templateId,
        name: draft.info.name,
        version: draft.version,
        status: 'draft',
        isActive: false
      })
    )
    if (recovered) return recovered
    throw new Error(
      'Create workflow trigger version API returned an unexpected response. Run `ghl app triggers pull` before retrying.'
    )
  }

  async updateWorkflowTriggerConfig(appId: string, templateId: string, body: unknown): Promise<void> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/triggers/${templateId}`, {
      method: 'PUT',
      body,
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId }
    })
    if (!isRecord(response) || response.success !== true) {
      throw new Error('Workflow trigger update API returned an unexpected response. Run `ghl app triggers pull` before retrying.')
    }
  }

  async updateWorkflowTriggerSummary(
    appId: string,
    templateId: string,
    body: { name?: string; version?: string; status?: string }
  ): Promise<WorkflowTriggerSummary> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/triggers/${templateId}/update`, {
      method: 'POST',
      body,
      baseUrl: this.config.oauthUrl
    })
    if (!isRecord(response) || response.success !== true || !isRecord(response.trigger) || !isWorkflowTriggerSummary(response.trigger)) {
      throw new Error('Workflow trigger registry update API returned an unexpected response. Run `ghl app triggers pull`.')
    }
    return response.trigger
  }

  async deleteWorkflowTrigger(appId: string, templateId: string): Promise<void> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/triggers/${templateId}`, {
      method: 'DELETE',
      baseUrl: this.config.oauthUrl
    })
    if (!isRecord(response) || response.success !== true) {
      throw new Error('Delete workflow trigger API returned an unexpected response. Run `ghl app triggers pull` to verify its state.')
    }
  }

  async submitWorkflowTriggerForReview(
    appId: string,
    body: { id: string; type: 'Trigger'; version: string; releaseNotes: { user: string; reviewer: string } }
  ): Promise<void> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/releases/submit-for-review', {
      method: 'POST',
      body,
      baseUrl: this.config.workflowsUrl,
      headers: { appid: appId }
    })
    if (!isRecord(response) || response.success !== true) {
      throw new Error('Workflow trigger review API returned an unexpected response. Run `ghl app triggers pull` to verify its state.')
    }
  }

  async publishWorkflowTriggerSummary(appId: string, templateId: string, version: string): Promise<void> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/clients/${appId}/triggers/${templateId}/publish`, {
      method: 'POST',
      body: { version },
      baseUrl: this.config.oauthUrl
    })
    if (!isRecord(response) || response.success !== true) {
      throw new Error('Workflow trigger publish registry API returned an unexpected response. Run `ghl app triggers pull`.')
    }
  }

  async updateAuthSettings(appId: string, versionId: string, body: unknown): Promise<ProfileUpdateResult> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/auth/${appId}/versions/${versionId}/settings`, {
      method: 'PUT',
      body
    })
    return validateProfileUpdateResponse(response, 'Auth settings update')
  }

  async makeRedirectUrlDefault(appId: string, versionId: string, redirectUrl: string): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/app/auth/${appId}/versions/${versionId}/redirectUrl/default`, {
      method: 'PUT',
      body: { redirectUrl }
    })
  }

  async addClientKey(appId: string, name: string): Promise<ClientKeyCreated> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/secrets/${appId}/clientKey`, {
      method: 'POST',
      body: { name }
    })
    const created = isRecord(response) && isRecord(response.clientKey) ? response.clientKey : response

    /* The secret is only ever returned here — if the response shape changed,
       fail loudly: a key without a captured secret is unusable. */
    if (!isRecord(created) || typeof created.id !== 'string' || !created.id || typeof created.secret !== 'string' || !created.secret) {
      throw new Error(
        'Client key response did not include an id/secret. The key may still have been created — ' +
          'check `ghl app keys` and delete it, then retry.'
      )
    }
    return { id: created.id, secret: created.secret }
  }

  async deleteClientKey(appId: string, clientKeyId: string): Promise<void> {
    await this.ensureTeam()
    await this.request<unknown>(`/app/secrets/${appId}/clientKey/${clientKeyId}`, { method: 'DELETE' })
  }

  async makeClientKeyDefault(appId: string, clientKeyId: string): Promise<void> {
    await this.ensureTeam()
    await this.request<unknown>(`/app/secrets/${appId}/clientKey/${clientKeyId}/default`, { method: 'PUT', body: {} })
  }

  async generateSsoKey(appId: string): Promise<{ ssoKey: string }> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/secrets/${appId}/ssokey`, { method: 'POST', body: {} })
    if (!isRecord(response) || typeof response.ssoKey !== 'string' || !response.ssoKey) {
      throw new Error('SSO key API returned an unexpected response. The key may have rotated; verify in the developer portal.')
    }
    return { ssoKey: response.ssoKey }
  }

  async listVersions(appId: string): Promise<VersionListItem[]> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/app/versions', { query: { appId } })
    if (
      !Array.isArray(response) ||
      !response.every(
        item =>
          isRecord(item) &&
          typeof item._id === 'string' &&
          item._id.length > 0 &&
          hasOptionalStringFields(item, ['appId', 'name', 'version', 'status'])
      )
    ) {
      throw new Error('App versions API returned an unexpected response.')
    }
    return response as VersionListItem[]
  }

  async analyzeVersion(appId: string, versionId: string): Promise<VersionAnalysis> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/${appId}/versions/${versionId}/analyze`)
    if (
      !isRecord(response) ||
      !hasOptionalStringFields(response, ['suggestedVersion', 'latestLiveVersion', 'updateType'], true)
    ) {
      throw new Error('Version analysis API returned an unexpected response.')
    }
    return response as VersionAnalysis
  }

  async publishVersion(
    appId: string,
    versionId: string,
    body: { newVersion: string; agencyNotes: string; subAccountNotes?: string }
  ): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/app/${appId}/versions/${versionId}/publish`, { method: 'POST', body })
  }

  async withdrawReview(appId: string, versionId: string): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/app/${appId}/versions/${versionId}/withdrawReview`, { method: 'POST', body: {} })
  }

  async cloneAsDraft(appId: string, versionId: string): Promise<{ id: string }> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/app/${appId}/versions/${versionId}/cloneAsDraft`, {
      method: 'POST',
      body: {}
    })
    if (
      !isRecord(response) ||
      !hasOptionalStringFields(response, ['_id', 'id']) ||
      ![response._id, response.id].some(id => typeof id === 'string' && id.length > 0)
    ) {
      throw new Error('Draft creation API returned an unexpected response. Run `ghl app versions` before retrying.')
    }
    return { id: typeof response._id === 'string' && response._id ? response._id : (response.id as string) }
  }

  async scheduleDeprecation(
    appId: string,
    versionId: string,
    body: { deprecateDate: string; timezone?: string; deprecationNotes: string }
  ): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/app/${appId}/versions/${versionId}/scheduleDeprecation`, { method: 'POST', body })
  }

  async requestSecurityReview(appId: string): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/app/${appId}/securityReview`, { method: 'POST', body: {} })
  }

  async getBillingPlans(appId: string): Promise<BillingPlan[]> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/billing/clients/${appId}/plans`)
    if (!Array.isArray(response) || !response.every(isBillingPlan)) {
      throw new Error('Billing plans API returned an unexpected response.')
    }
    return response
  }

  async updateBillingSettings(appId: string, body: BillingSettings): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/billing/settings/${appId}`, { method: 'PUT', body })
  }

  async addBillingPlan(appId: string, body: unknown): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/billing/clients/${appId}/plans`, { method: 'POST', body })
  }

  async updateBillingPlan(appId: string, planId: string, body: unknown): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/billing/clients/${appId}/plans/${planId}`, { method: 'PUT', body })
  }

  async deleteBillingPlan(appId: string, planId: string): Promise<void> {
    await this.ensureTeam()
    await this.request<unknown>(`/billing/clients/${appId}/plans/${planId}`, { method: 'DELETE' })
  }

  /* Portal-parity helper: switching from freemium to paid drops every free
     plan in one call, matching the portal's confirm-and-delete-all flow. */
  async deleteAllFreePlans(appId: string): Promise<void> {
    await this.ensureTeam()
    await this.request<unknown>(`/billing/clients/${appId}/plans/free`, { method: 'DELETE' })
  }

  async getBillingUsageMeters(appId: string): Promise<BillingUsageMeter[]> {
    await this.ensureTeam()
    const response = await this.request<unknown>(`/billing/usage/${appId}/meter`)
    if (!Array.isArray(response) || !response.every(isBillingUsageMeter)) {
      throw new Error('Usage-based billing API returned an unexpected response.')
    }
    return response
  }

  async addBillingUsageMeter(appId: string, body: unknown): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/billing/usage/${appId}/meter`, { method: 'POST', body })
  }

  async updateBillingUsageTier(appId: string, meterId: string, tierId: string, body: unknown): Promise<unknown> {
    await this.ensureTeam()
    return this.request<unknown>(`/billing/usage/${appId}/meter/${meterId}/tier/${tierId}`, {
      method: 'PATCH',
      body
    })
  }

  async deleteBillingUsageMeter(appId: string, meterId: string): Promise<void> {
    await this.ensureTeam()
    await this.request<unknown>(`/billing/usage/${appId}/meter/${meterId}`, { method: 'DELETE' })
  }

  async deleteBillingUsageTier(appId: string, meterId: string, tierId: string): Promise<void> {
    await this.ensureTeam()
    await this.request<unknown>(`/billing/usage/${appId}/meter/${meterId}/tier/${tierId}`, { method: 'DELETE' })
  }

  /* Sandbox accounts are developer-scoped, not app-scoped: GET returns the
     accounts plus a companyId -> installed-app-names map. */
  async listSandboxAccounts(): Promise<SandboxAccountsResponse> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/sandbox')
    if (
      !isRecord(response) ||
      !Array.isArray(response.accounts) ||
      !response.accounts.every(isSandboxAccount) ||
      !isRecord(response.apps ?? {}) ||
      !Object.values(response.apps ?? {}).every(
        appNames => Array.isArray(appNames) && appNames.every(name => typeof name === 'string')
      )
    ) {
      throw new Error('Sandbox API returned an unexpected response.')
    }
    return {
      accounts: response.accounts as SandboxAccount[],
      apps: (response.apps ?? {}) as Record<string, string[]>
    }
  }

  async createSandboxAccount(companyName: string, password: string): Promise<SandboxAccount> {
    await this.ensureTeam()
    const response = await this.request<unknown>('/sandbox', { method: 'POST', body: { companyName, password } })
    if (!isSandboxAccount(response)) {
      throw new Error('Sandbox creation returned an unexpected response.')
    }
    return response as SandboxAccount
  }

  /* Deletion is by the sandbox record _id (not companyId); the backend
     soft-deletes and cancels any pending renewal. */
  async deleteSandboxAccount(id: string): Promise<void> {
    await this.ensureTeam()
    await this.request<unknown>(`/sandbox/${id}`, { method: 'DELETE' })
  }
}

/* The upload endpoint returns either [{fileName, fileUrl}] or {files: {name: url}}. */
export function normalizeUploadResponse(response: unknown): Record<string, string> {
  if (Array.isArray(response)) {
    const map: Record<string, string> = {}
    for (const file of response) {
      const entry = isRecord(file) ? normalizeUploadEntry(file.fileName, file.fileUrl) : undefined
      if (!entry) {
        throw new Error('File upload API returned an unexpected response.')
      }
      if (Object.hasOwn(map, entry.name)) {
        throw new Error(`File upload API returned a duplicate file name: ${entry.name}`)
      }
      map[entry.name] = entry.url
    }
    return map
  }
  if (isRecord(response) && isRecord(response.files)) {
    const map: Record<string, string> = {}
    for (const [name, url] of Object.entries(response.files)) {
      const entry = normalizeUploadEntry(name, url)
      if (!entry) throw new Error('File upload API returned an unexpected response.')
      map[entry.name] = entry.url
    }
    return map
  }
  throw new Error('File upload API returned an unexpected response.')
}

function normalizeUploadEntry(name: unknown, url: unknown): { name: string; url: string } | undefined {
  if (typeof name !== 'string' || !name.trim() || typeof url !== 'string' || !url.trim()) return undefined
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) return undefined
    return { name, url }
  } catch {
    return undefined
  }
}

function isSandboxAccount(value: unknown): value is SandboxAccount {
  if (!isRecord(value)) return false
  if (typeof value._id !== 'string' || !value._id) return false
  if (typeof value.name !== 'string' || !value.name) return false
  if (typeof value.companyId !== 'string' || !value.companyId) return false

  return ['relationshipNumber', 'expiryDate', 'status'].every(
    field => value[field] === undefined || typeof value[field] === 'string'
  )
}
