import { isRecord } from '../api/response.js'

export type ExternalAuthType = 'basic' | 'oauth2'
export type ExternalAuthHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
export type ExternalAuthCodeModeStep =
  | 'authorizationUrl'
  | 'accessTokenRequest'
  | 'refreshTokenRequest'
  | 'testRequest'
  | 'userInfoRequest'

export interface ExternalAuthKeyValue {
  key: string
  value: string
}

export interface ExternalAuthRequestConfig {
  url: string
  method: ExternalAuthHttpMethod
  urlParams: ExternalAuthKeyValue[]
  headers: ExternalAuthKeyValue[]
  body: ExternalAuthKeyValue[]
}

export interface ExternalAuthField {
  key: string
  label: string
  required: boolean
  type: 'text' | 'password'
  helpText: string
  defaultValue: string
  toBeShownForAgencyInstallation: boolean
}

export interface ExternalAuthIdentityMapping {
  id: string
  name: string
  email: string
}

export interface ExternalAuthCodeModeStepConfig {
  enabled: boolean
  code: string
}

export type ExternalAuthCodeModeConfig = Partial<Record<ExternalAuthCodeModeStep, ExternalAuthCodeModeStepConfig>>

export interface ExternalAuthBasicConfig {
  accountInfoSameAsRequestConfig: boolean
  accountInfoConfig?: ExternalAuthRequestConfig
  accountInfoMapping?: ExternalAuthIdentityMapping
}

export interface ExternalAuthOAuth2Config {
  externalAppName: string
  clientId: string
  clientSecret: string
  scopes: string
  pkceEnabled: boolean
  authorizationUrlConfig: ExternalAuthRequestConfig
  accessTokenConfig: ExternalAuthRequestConfig
  longLivedAccessTokenConfig?: ExternalAuthRequestConfig
  refreshTokenConfig?: ExternalAuthRequestConfig
  isAutoRefreshTokenEnabled: boolean
  userInfoSameAsRequestConfig: boolean
  userInfoConfig?: ExternalAuthRequestConfig
  userInfoMapping?: ExternalAuthIdentityMapping
  codeMode?: ExternalAuthCodeModeConfig
}

export interface ExternalAuthManifest {
  schemaVersion: 1
  appId: string
  versionId: string
  enabled: boolean
  updateAllRefreshTokens: boolean
  type: ExternalAuthType
  fields: ExternalAuthField[]
  requestConfig: ExternalAuthRequestConfig
  accountDataUri?: string
  capabilities: {
    hasWhoAmIApi: boolean
    multiAuthEnabled: boolean
  }
  basic?: ExternalAuthBasicConfig
  oauth2?: ExternalAuthOAuth2Config
}

export interface ExternalAuthCapabilityLocks {
  hasWhoAmIApiDisableLocked: boolean
  multiAuthEnabledDisableLocked: boolean
  authTypeLocked?: boolean
  lockedAuthType?: ExternalAuthType
  oauth2TypeLocked?: boolean
}

export interface ExternalAuthApiConfig {
  type?: ExternalAuthType
  fields?: Array<Partial<ExternalAuthField> & { _id?: unknown }>
  requestConfig?: Partial<ExternalAuthRequestConfig>
  accountDataUri?: string
  hasWhoAmIApi?: boolean
  multiAuthEnabled?: boolean
  allowManualMultiAuth?: boolean
  resolvedCapabilities?: Partial<ExternalAuthManifest['capabilities']>
  capabilityLocks?: Partial<ExternalAuthCapabilityLocks>
  accountInfoSameAsRequestConfig?: boolean
  accountInfoConfig?: Partial<ExternalAuthRequestConfig>
  accountInfoMapping?: Partial<ExternalAuthIdentityMapping>
  userInfoConfig?: Partial<ExternalAuthRequestConfig>
  userInfoMapping?: Partial<ExternalAuthIdentityMapping>
  codeMode?: ExternalAuthCodeModeConfig
  tokenManagement?: {
    name?: string
    clientId?: string
    clientSecret?: string
    scopes?: string
    pkceEnabled?: boolean
    authorizationUrlConfig?: Partial<ExternalAuthRequestConfig>
    accessTokenConfig?: Partial<ExternalAuthRequestConfig>
    longLivedAccessTokenConfig?: Partial<ExternalAuthRequestConfig>
    refreshTokenConfig?: Partial<ExternalAuthRequestConfig>
    isAutoRefreshTokenEnabled?: boolean
    userInfoSameAsRequestConfig?: boolean
    userInfoConfig?: Partial<ExternalAuthRequestConfig>
  }
}

export interface ExternalAuthApiResponse {
  hasExternalAuth?: boolean
  updateAllRefreshTokens?: boolean
  externalAuthConfig?: ExternalAuthApiConfig
}

export interface ExternalAuthUpdateBody {
  fields: ExternalAuthField[]
  requestConfig: ExternalAuthRequestConfig
  hasExternalAuth: boolean
  updateAllRefreshTokens: boolean
  type: ExternalAuthType
  accountDataUri?: string
  hasWhoAmIApi: boolean
  multiAuthEnabled: boolean
  accountInfoSameAsRequestConfig?: boolean
  accountInfoConfig?: ExternalAuthRequestConfig
  accountInfoMapping?: ExternalAuthIdentityMapping
  authorizationUrlConfig?: ExternalAuthRequestConfig
  accessTokenConfig?: ExternalAuthRequestConfig
  longLivedAccessTokenConfig?: ExternalAuthRequestConfig | Record<string, never>
  refreshTokenConfig?: ExternalAuthRequestConfig
  isAutoRefreshTokenEnabled?: boolean
  scopes?: string
  clientId?: string
  clientSecret?: string
  externalAppName?: string
  pkceEnabled?: boolean
  userInfoSameAsRequestConfig?: boolean
  userInfoConfig?: ExternalAuthRequestConfig
  userInfoMapping?: ExternalAuthIdentityMapping
  codeMode?: ExternalAuthCodeModeConfig
}

export const EXTERNAL_AUTH_REMOTE_REFERENCE = '${remote}'
export const EXTERNAL_AUTH_ENV_REFERENCE = /^\$\{env:([A-Z_][A-Z0-9_]*)\}$/

const SENSITIVE_KEY_PARTS = ['authorization', 'cookie', 'credential', 'password', 'passwd', 'secret', 'token', 'api-key', 'api_key', 'apikey']

function requestConfig(value?: Partial<ExternalAuthRequestConfig>, method: ExternalAuthHttpMethod = 'GET'): ExternalAuthRequestConfig {
  return {
    url: typeof value?.url === 'string' ? value.url : '',
    method: typeof value?.method === 'string' ? value.method : method,
    urlParams: keyValues(value?.urlParams),
    headers: keyValues(value?.headers),
    body: keyValues(value?.body)
  }
}

function keyValues(value: unknown): ExternalAuthKeyValue[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry =>
    isRecord(entry) && typeof entry.key === 'string' && typeof entry.value === 'string'
      ? [{ key: entry.key, value: entry.value }]
      : []
  )
}

function identityMapping(value?: Partial<ExternalAuthIdentityMapping>): ExternalAuthIdentityMapping {
  return {
    id: typeof value?.id === 'string' ? value.id : '',
    name: typeof value?.name === 'string' ? value.name : '',
    email: typeof value?.email === 'string' ? value.email : ''
  }
}

function fields(value: ExternalAuthApiConfig['fields']): ExternalAuthField[] {
  if (!Array.isArray(value)) return []
  return value.map(field => ({
    key: typeof field.key === 'string' ? field.key : '',
    label: typeof field.label === 'string' ? field.label : '',
    required: field.required === true,
    type: field.type === 'password' ? 'password' : 'text',
    helpText: typeof field.helpText === 'string' ? field.helpText : '',
    defaultValue: typeof field.defaultValue === 'string' ? field.defaultValue : '',
    toBeShownForAgencyInstallation: field.toBeShownForAgencyInstallation === true
  }))
}

function containsProviderTemplate(value: string): boolean {
  return /\{\{(?:userData|externalApp|bundle)\.[^{}]+\}\}/.test(value)
}

function sensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase()
  return SENSITIVE_KEY_PARTS.some(part => normalized.includes(part)) || normalized.split(/[-_.]/).includes('auth')
}

function redactValue(value: string, sensitive: boolean): string {
  return sensitive && value.length > 0 && !containsProviderTemplate(value)
    ? EXTERNAL_AUTH_REMOTE_REFERENCE
    : value
}

function redactCredential(value: string): string {
  return value.length > 0 ? EXTERNAL_AUTH_REMOTE_REFERENCE : value
}

function redactKeyValues(values: ExternalAuthKeyValue[], section: 'body' | 'headers' | 'urlParams'): ExternalAuthKeyValue[] {
  return values.map(item => ({
    key: item.key,
    value: redactValue(
      item.value,
      sensitiveKey(item.key)
    )
  }))
}

function redactRequestUrl(value: string): string {
  if (!value) return value
  try {
    return [...new URL(value).searchParams.keys()].some(sensitiveKey)
      ? EXTERNAL_AUTH_REMOTE_REFERENCE
      : value
  } catch {
    return value
  }
}

function redactRequestConfig(value?: Partial<ExternalAuthRequestConfig>, method: ExternalAuthHttpMethod = 'GET'): ExternalAuthRequestConfig {
  const normalized = requestConfig(value, method)
  return {
    ...normalized,
    url: redactRequestUrl(normalized.url),
    urlParams: redactKeyValues(normalized.urlParams, 'urlParams'),
    headers: redactKeyValues(normalized.headers, 'headers'),
    body: redactKeyValues(normalized.body, 'body')
  }
}

function redactFields(value: ExternalAuthField[]): ExternalAuthField[] {
  return value.map(field => ({
    ...field,
    defaultValue: field.type === 'password' || sensitiveKey(field.key)
      ? redactCredential(field.defaultValue)
      : field.defaultValue
  }))
}

function defaultAuthorizationRequest(): ExternalAuthRequestConfig {
  return {
    ...requestConfig(undefined, 'GET'),
    urlParams: [
      { key: 'client_id', value: '{{externalApp.clientId}}' },
      { key: 'scope', value: '{{externalApp.scope}}' },
      { key: 'response_type', value: 'code' },
      { key: 'state', value: '{{bundle.state}}' },
      { key: 'redirect_uri', value: '{{bundle.redirectUrl}}' }
    ]
  }
}

function defaultAccessTokenRequest(): ExternalAuthRequestConfig {
  return {
    ...requestConfig(undefined, 'POST'),
    headers: [
      { key: 'content-type', value: 'application/x-www-form-urlencoded' },
      { key: 'accept', value: 'application/json' }
    ],
    body: [
      { key: 'client_id', value: '{{externalApp.clientId}}' },
      { key: 'client_secret', value: '{{externalApp.clientSecret}}' },
      { key: 'state', value: '{{bundle.state}}' },
      { key: 'redirect_uri', value: '{{bundle.redirectUrl}}' },
      { key: 'code', value: '{{bundle.code}}' },
      { key: 'grant_type', value: 'authorization_code' }
    ]
  }
}

function defaultRefreshTokenRequest(): ExternalAuthRequestConfig {
  return {
    ...requestConfig(undefined, 'POST'),
    headers: [
      { key: 'content-type', value: 'application/x-www-form-urlencoded' },
      { key: 'accept', value: 'application/json' }
    ],
    body: [
      { key: 'refresh_token', value: '{{bundle.refreshToken}}' },
      { key: 'grant_type', value: 'refresh_token' }
    ]
  }
}

function defaultTestRequest(): ExternalAuthRequestConfig {
  return {
    ...requestConfig(undefined, 'GET'),
    headers: [{ key: 'authorization', value: 'Bearer {{bundle.accessToken}}' }]
  }
}

function defaultUserInfoRequest(): ExternalAuthRequestConfig {
  return {
    ...defaultTestRequest(),
    headers: [
      { key: 'authorization', value: 'Bearer {{bundle.accessToken}}' },
      { key: 'accept', value: 'application/json' }
    ]
  }
}

function optionalRequest(
  value: Partial<ExternalAuthRequestConfig> | undefined,
  method: ExternalAuthHttpMethod = 'GET'
): ExternalAuthRequestConfig | undefined {
  return value ? redactRequestConfig(value, method) : undefined
}

function capabilities(config: ExternalAuthApiConfig): ExternalAuthManifest['capabilities'] {
  const hasWhoAmIApi = config.hasWhoAmIApi ?? config.resolvedCapabilities?.hasWhoAmIApi ?? false
  const multiAuthEnabled =
    config.multiAuthEnabled ?? config.resolvedCapabilities?.multiAuthEnabled ?? config.allowManualMultiAuth ?? false
  return { hasWhoAmIApi, multiAuthEnabled }
}

export function buildExternalAuthManifest(
  appId: string,
  versionId: string,
  response: ExternalAuthApiResponse
): ExternalAuthManifest {
  const config = response.externalAuthConfig ?? {}
  const type: ExternalAuthType = config.type === 'basic' ? 'basic' : 'oauth2'
  const common: Omit<ExternalAuthManifest, 'basic' | 'oauth2'> = {
    schemaVersion: 1,
    appId,
    versionId,
    enabled: response.hasExternalAuth === true,
    updateAllRefreshTokens: response.updateAllRefreshTokens === true,
    type,
    fields: redactFields(fields(config.fields)),
    requestConfig: config.requestConfig
      ? redactRequestConfig(config.requestConfig)
      : type === 'oauth2'
        ? defaultTestRequest()
        : requestConfig(undefined, 'GET'),
    ...(typeof config.accountDataUri === 'string' ? { accountDataUri: redactRequestUrl(config.accountDataUri) } : {}),
    capabilities: capabilities(config)
  }

  if (type === 'basic') {
    return {
      ...common,
      basic: {
        accountInfoSameAsRequestConfig: config.accountInfoSameAsRequestConfig === true,
        ...(optionalRequest(config.accountInfoConfig) ? { accountInfoConfig: optionalRequest(config.accountInfoConfig) } : {}),
        ...(config.accountInfoMapping ? { accountInfoMapping: identityMapping(config.accountInfoMapping) } : {})
      }
    }
  }

  const token = config.tokenManagement ?? {}
  const userInfoConfig = config.userInfoConfig ?? token.userInfoConfig
  const authorizationUrlConfig = token.authorizationUrlConfig
    ? redactRequestConfig(token.authorizationUrlConfig, 'GET')
    : defaultAuthorizationRequest()
  const accessTokenConfig = token.accessTokenConfig
    ? redactRequestConfig(token.accessTokenConfig, 'POST')
    : defaultAccessTokenRequest()
  const refreshTokenConfig = token.refreshTokenConfig
    ? redactRequestConfig(token.refreshTokenConfig, 'POST')
    : defaultRefreshTokenRequest()

  return {
    ...common,
    oauth2: {
      externalAppName: token.name ?? '',
      clientId: redactCredential(token.clientId ?? ''),
      clientSecret: redactCredential(token.clientSecret ?? ''),
      scopes: token.scopes ?? '',
      pkceEnabled: token.pkceEnabled === true,
      authorizationUrlConfig,
      accessTokenConfig,
      ...(optionalRequest(token.longLivedAccessTokenConfig) ? {
        longLivedAccessTokenConfig: optionalRequest(token.longLivedAccessTokenConfig)
      } : {}),
      refreshTokenConfig,
      isAutoRefreshTokenEnabled: token.isAutoRefreshTokenEnabled !== false,
      userInfoSameAsRequestConfig: token.userInfoSameAsRequestConfig === true,
      ...(userInfoConfig ? { userInfoConfig: redactRequestConfig(userInfoConfig) } : {
        userInfoConfig: defaultUserInfoRequest()
      }),
      ...(config.userInfoMapping ? { userInfoMapping: identityMapping(config.userInfoMapping) } : {}),
      ...(config.codeMode ? { codeMode: structuredClone(config.codeMode) } : {})
    }
  }
}

function remoteReference(value: string, remoteValue: unknown, path: string, environment: NodeJS.ProcessEnv): string {
  if (value === EXTERNAL_AUTH_REMOTE_REFERENCE) {
    if (typeof remoteValue !== 'string' || remoteValue.length === 0) {
      throw new Error(`No remote value is available for ${path}, which uses \${remote}.`)
    }
    return remoteValue
  }
  const variable = EXTERNAL_AUTH_ENV_REFERENCE.exec(value)?.[1]
  if (!variable) return value
  const resolved = environment[variable]
  if (!resolved) throw new Error(`${path} references unset environment variable ${variable}.`)
  return resolved
}

function findRemoteValue(
  entries: ExternalAuthKeyValue[] | undefined,
  key: string,
  section: 'body' | 'headers' | 'urlParams'
): string | undefined {
  return entries?.find(entry =>
    section === 'headers'
      ? entry.key.toLowerCase() === key.toLowerCase()
      : entry.key === key
  )?.value
}

function resolveKeyValues(
  local: ExternalAuthKeyValue[],
  remote: ExternalAuthKeyValue[] | undefined,
  section: 'body' | 'headers' | 'urlParams',
  path: string,
  environment: NodeJS.ProcessEnv
): ExternalAuthKeyValue[] {
  return local.map((entry, index) => ({
    key: entry.key,
    value: remoteReference(
      entry.value,
      findRemoteValue(remote, entry.key, section),
      `${path}.${section}[${index}].value`,
      environment
    )
  }))
}

function resolveRequest(
  local: ExternalAuthRequestConfig,
  remote: Partial<ExternalAuthRequestConfig> | undefined,
  path: string,
  environment: NodeJS.ProcessEnv
): ExternalAuthRequestConfig {
  const normalizedRemote = requestConfig(remote, local.method)
  return {
    url: remoteReference(local.url, normalizedRemote.url, `${path}.url`, environment),
    method: local.method,
    urlParams: resolveKeyValues(local.urlParams, normalizedRemote.urlParams, 'urlParams', path, environment),
    headers: resolveKeyValues(local.headers, normalizedRemote.headers, 'headers', path, environment),
    body: resolveKeyValues(local.body, normalizedRemote.body, 'body', path, environment)
  }
}

function resolveFields(
  local: ExternalAuthField[],
  remote: ExternalAuthApiConfig['fields'],
  environment: NodeJS.ProcessEnv
): ExternalAuthField[] {
  return local.map((field, index) => {
    const remoteField = remote?.find(candidate => candidate.key === field.key)
    return {
      ...field,
      defaultValue: remoteReference(
        field.defaultValue,
        remoteField?.defaultValue,
        `config.json.fields[${index}].defaultValue`,
        environment
      )
    }
  })
}

export function prepareExternalAuthUpdateBody(
  manifest: ExternalAuthManifest,
  remote: ExternalAuthApiResponse,
  environment: NodeJS.ProcessEnv = process.env
): ExternalAuthUpdateBody {
  const remoteConfig = remote.externalAuthConfig ?? {}
  const body: ExternalAuthUpdateBody = {
    fields: resolveFields(manifest.fields, remoteConfig.fields, environment),
    requestConfig: resolveRequest(manifest.requestConfig, remoteConfig.requestConfig, 'config.json.requestConfig', environment),
    hasExternalAuth: manifest.enabled,
    updateAllRefreshTokens: manifest.updateAllRefreshTokens,
    type: manifest.type,
    ...(manifest.accountDataUri ? {
      accountDataUri: remoteReference(
        manifest.accountDataUri,
        remoteConfig.accountDataUri,
        'config.json.accountDataUri',
        environment
      )
    } : {}),
    hasWhoAmIApi: manifest.capabilities.hasWhoAmIApi,
    multiAuthEnabled: manifest.capabilities.multiAuthEnabled
  }

  if (manifest.type === 'basic') {
    const basic = manifest.basic as ExternalAuthBasicConfig
    return {
      ...body,
      accountInfoSameAsRequestConfig: basic.accountInfoSameAsRequestConfig,
      ...(!basic.accountInfoSameAsRequestConfig && basic.accountInfoConfig ? {
        accountInfoConfig: resolveRequest(
          basic.accountInfoConfig,
          remoteConfig.accountInfoConfig,
          'config.json.basic.accountInfoConfig',
          environment
        )
      } : {}),
      ...(manifest.capabilities.hasWhoAmIApi && basic.accountInfoMapping
        ? { accountInfoMapping: structuredClone(basic.accountInfoMapping) }
        : {})
    }
  }

  const oauth = manifest.oauth2 as ExternalAuthOAuth2Config
  const remoteToken = remoteConfig.tokenManagement
  return {
    ...body,
    authorizationUrlConfig: resolveRequest(
      oauth.authorizationUrlConfig,
      remoteToken?.authorizationUrlConfig,
      'config.json.oauth2.authorizationUrlConfig',
      environment
    ),
    accessTokenConfig: resolveRequest(
      oauth.accessTokenConfig,
      remoteToken?.accessTokenConfig,
      'config.json.oauth2.accessTokenConfig',
      environment
    ),
    longLivedAccessTokenConfig: oauth.longLivedAccessTokenConfig
      ? resolveRequest(
          oauth.longLivedAccessTokenConfig,
          remoteToken?.longLivedAccessTokenConfig,
          'config.json.oauth2.longLivedAccessTokenConfig',
          environment
        )
      : {},
    ...(oauth.refreshTokenConfig ? {
      refreshTokenConfig: resolveRequest(
        oauth.refreshTokenConfig,
        remoteToken?.refreshTokenConfig,
        'config.json.oauth2.refreshTokenConfig',
        environment
      )
    } : {}),
    isAutoRefreshTokenEnabled: oauth.isAutoRefreshTokenEnabled,
    scopes: oauth.scopes,
    clientId: remoteReference(
      oauth.clientId,
      remoteToken?.clientId,
      'config.json.oauth2.clientId',
      environment
    ),
    clientSecret: remoteReference(
      oauth.clientSecret,
      remoteToken?.clientSecret,
      'config.json.oauth2.clientSecret',
      environment
    ),
    externalAppName: oauth.externalAppName,
    pkceEnabled: oauth.pkceEnabled,
    userInfoSameAsRequestConfig: oauth.userInfoSameAsRequestConfig,
    ...(oauth.userInfoSameAsRequestConfig
      ? { userInfoConfig: body.requestConfig }
      : oauth.userInfoConfig?.url
        ? {
            userInfoConfig: resolveRequest(
              oauth.userInfoConfig,
              remoteConfig.userInfoConfig ?? remoteToken?.userInfoConfig,
              'config.json.oauth2.userInfoConfig',
              environment
            )
          }
        : {}),
    ...(manifest.capabilities.hasWhoAmIApi && oauth.userInfoMapping
      ? { userInfoMapping: structuredClone(oauth.userInfoMapping) }
      : {}),
    ...(oauth.codeMode ? { codeMode: structuredClone(oauth.codeMode) } : {})
  }
}

export function externalAuthCapabilityLocks(response: ExternalAuthApiResponse): ExternalAuthCapabilityLocks {
  const locks = response.externalAuthConfig?.capabilityLocks
  const authTypeLocked = locks?.authTypeLocked ?? false
  const lockedAuthType = locks?.lockedAuthType === 'basic' || locks?.lockedAuthType === 'oauth2'
    ? locks.lockedAuthType
    : undefined
  return {
    hasWhoAmIApiDisableLocked: locks?.hasWhoAmIApiDisableLocked ?? false,
    multiAuthEnabledDisableLocked: locks?.multiAuthEnabledDisableLocked ?? false,
    authTypeLocked,
    ...(authTypeLocked && lockedAuthType ? { lockedAuthType } : {}),
    oauth2TypeLocked: authTypeLocked && lockedAuthType === 'oauth2'
  }
}
