import { isRecord, sanitizeTerminalText } from '../api/response.js'
import { isAppResourceIdentifier } from '../app/schema.js'
import { validateHttpUrl, validateXssSafe } from '../shared/validation.js'
import { workflowActionCodeSyntaxError } from '../workflows/actions/code.js'
import {
  EXTERNAL_AUTH_ENV_REFERENCE,
  EXTERNAL_AUTH_REMOTE_REFERENCE,
  ExternalAuthCapabilityLocks,
  ExternalAuthCodeModeStep,
  ExternalAuthHttpMethod,
  ExternalAuthKeyValue,
  ExternalAuthManifest,
  ExternalAuthRequestConfig
} from './manifest.js'

const ROOT_KEYS = new Set([
  'schemaVersion',
  'appId',
  'versionId',
  'enabled',
  'updateAllRefreshTokens',
  'type',
  'fields',
  'requestConfig',
  'accountDataUri',
  'capabilities',
  'basic',
  'oauth2'
])
const FIELD_KEYS = new Set([
  'key',
  'label',
  'required',
  'type',
  'helpText',
  'defaultValue',
  'toBeShownForAgencyInstallation'
])
const REQUEST_KEYS = new Set(['url', 'method', 'urlParams', 'headers', 'body'])
const KEY_VALUE_KEYS = new Set(['key', 'value'])
const CAPABILITY_KEYS = new Set(['hasWhoAmIApi', 'multiAuthEnabled'])
const BASIC_KEYS = new Set(['accountInfoSameAsRequestConfig', 'accountInfoConfig', 'accountInfoMapping'])
const OAUTH_KEYS = new Set([
  'externalAppName',
  'clientId',
  'clientSecret',
  'scopes',
  'pkceEnabled',
  'authorizationUrlConfig',
  'accessTokenConfig',
  'longLivedAccessTokenConfig',
  'refreshTokenConfig',
  'isAutoRefreshTokenEnabled',
  'userInfoSameAsRequestConfig',
  'userInfoConfig',
  'userInfoMapping',
  'codeMode'
])
const IDENTITY_KEYS = new Set(['id', 'name', 'email'])
const CODE_MODE_STEPS = new Set<ExternalAuthCodeModeStep>([
  'authorizationUrl',
  'accessTokenRequest',
  'refreshTokenRequest',
  'testRequest',
  'userInfoRequest'
])
const CODE_STEP_KEYS = new Set(['enabled', 'code'])
const HTTP_METHODS = new Set<ExternalAuthHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
const BASIC_METHODS = new Set<ExternalAuthHttpMethod>(['GET', 'POST', 'PUT', 'PATCH'])
const SAFE_FIELD_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g
const SECRET_REFERENCE = /^\$\{(?:remote|env:[A-Z_][A-Z0-9_]*)\}$/
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const SENSITIVE_KEY_PARTS = ['authorization', 'cookie', 'credential', 'password', 'passwd', 'secret', 'token', 'api-key', 'api_key', 'apikey']
const MAX_KEY_VALUES = 100
const MAX_CODE_BYTES = 64 * 1024

function validateExactKeys(value: unknown, allowed: ReadonlySet<string>, path: string, errors: string[]): value is Record<string, unknown> {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`)
    return false
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${sanitizeTerminalText(key)} is not a supported property.`)
  }
  return true
}

function requiredString(value: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof value[key] !== 'string') errors.push(`${path}.${key} must be a string.`)
}

function requiredBoolean(value: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof value[key] !== 'boolean') errors.push(`${path}.${key} must be a boolean.`)
}

function validateKeyValues(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`)
    return
  }
  if (value.length > MAX_KEY_VALUES) errors.push(`${path} supports at most ${MAX_KEY_VALUES} entries.`)
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`
    if (!validateExactKeys(entry, KEY_VALUE_KEYS, entryPath, errors)) return
    requiredString(entry, 'key', entryPath, errors)
    requiredString(entry, 'value', entryPath, errors)
  })
}

function validateRequestShape(value: unknown, path: string, errors: string[]): void {
  if (!validateExactKeys(value, REQUEST_KEYS, path, errors)) return
  requiredString(value, 'url', path, errors)
  requiredString(value, 'method', path, errors)
  validateKeyValues(value.urlParams, `${path}.urlParams`, errors)
  validateKeyValues(value.headers, `${path}.headers`, errors)
  validateKeyValues(value.body, `${path}.body`, errors)
}

function validateIdentityShape(value: unknown, path: string, errors: string[]): void {
  if (!validateExactKeys(value, IDENTITY_KEYS, path, errors)) return
  for (const key of IDENTITY_KEYS) requiredString(value, key, path, errors)
}

function hasKeyValueShape(value: unknown): value is ExternalAuthKeyValue {
  return isRecord(value) && typeof value.key === 'string' && typeof value.value === 'string'
}

function hasRequestShape(value: unknown): value is ExternalAuthRequestConfig {
  return isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.method === 'string' &&
    Array.isArray(value.urlParams) && value.urlParams.every(hasKeyValueShape) &&
    Array.isArray(value.headers) && value.headers.every(hasKeyValueShape) &&
    Array.isArray(value.body) && value.body.every(hasKeyValueShape)
}

function hasIdentityShape(value: unknown): boolean {
  return isRecord(value) && ['id', 'name', 'email'].every(key => typeof value[key] === 'string')
}

function hasFieldShape(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.label === 'string' &&
    typeof value.required === 'boolean' &&
    (value.type === 'text' || value.type === 'password') &&
    typeof value.helpText === 'string' &&
    typeof value.defaultValue === 'string' &&
    typeof value.toBeShownForAgencyInstallation === 'boolean'
}

function hasBasicShape(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.accountInfoSameAsRequestConfig === 'boolean' &&
    (value.accountInfoConfig === undefined || hasRequestShape(value.accountInfoConfig)) &&
    (value.accountInfoMapping === undefined || hasIdentityShape(value.accountInfoMapping))
}

function hasOAuthShape(value: unknown): boolean {
  if (!isRecord(value)) return false
  const codeModeIsValid = value.codeMode === undefined || (
    isRecord(value.codeMode) && Object.values(value.codeMode).every(config =>
      isRecord(config) && typeof config.enabled === 'boolean' && typeof config.code === 'string'
    )
  )
  return ['externalAppName', 'clientId', 'clientSecret', 'scopes'].every(key => typeof value[key] === 'string') &&
    typeof value.pkceEnabled === 'boolean' &&
    typeof value.isAutoRefreshTokenEnabled === 'boolean' &&
    typeof value.userInfoSameAsRequestConfig === 'boolean' &&
    hasRequestShape(value.authorizationUrlConfig) &&
    hasRequestShape(value.accessTokenConfig) &&
    (value.longLivedAccessTokenConfig === undefined || hasRequestShape(value.longLivedAccessTokenConfig)) &&
    (value.refreshTokenConfig === undefined || hasRequestShape(value.refreshTokenConfig)) &&
    (value.userInfoConfig === undefined || hasRequestShape(value.userInfoConfig)) &&
    (value.userInfoMapping === undefined || hasIdentityShape(value.userInfoMapping)) &&
    codeModeIsValid
}

function validateManifestShape(value: unknown, errors: string[]): value is ExternalAuthManifest {
  if (!validateExactKeys(value, ROOT_KEYS, 'config.json', errors)) return false
  if (value.schemaVersion !== 1) errors.push('config.json.schemaVersion must be 1.')
  requiredString(value, 'appId', 'config.json', errors)
  requiredString(value, 'versionId', 'config.json', errors)
  requiredBoolean(value, 'enabled', 'config.json', errors)
  requiredBoolean(value, 'updateAllRefreshTokens', 'config.json', errors)
  if (value.type !== 'basic' && value.type !== 'oauth2') errors.push('config.json.type must be "basic" or "oauth2".')

  if (!Array.isArray(value.fields)) {
    errors.push('config.json.fields must be an array.')
  } else {
    value.fields.forEach((field, index) => {
      const path = `config.json.fields[${index}]`
      if (!validateExactKeys(field, FIELD_KEYS, path, errors)) return
      requiredString(field, 'key', path, errors)
      requiredString(field, 'label', path, errors)
      requiredBoolean(field, 'required', path, errors)
      if (field.type !== 'text' && field.type !== 'password') errors.push(`${path}.type must be "text" or "password".`)
      requiredString(field, 'helpText', path, errors)
      requiredString(field, 'defaultValue', path, errors)
      requiredBoolean(field, 'toBeShownForAgencyInstallation', path, errors)
    })
  }

  validateRequestShape(value.requestConfig, 'config.json.requestConfig', errors)
  if (value.accountDataUri !== undefined && typeof value.accountDataUri !== 'string') {
    errors.push('config.json.accountDataUri must be a string.')
  }

  if (validateExactKeys(value.capabilities, CAPABILITY_KEYS, 'config.json.capabilities', errors)) {
    requiredBoolean(value.capabilities, 'hasWhoAmIApi', 'config.json.capabilities', errors)
    requiredBoolean(value.capabilities, 'multiAuthEnabled', 'config.json.capabilities', errors)
  }

  if (value.basic !== undefined && validateExactKeys(value.basic, BASIC_KEYS, 'config.json.basic', errors)) {
    requiredBoolean(value.basic, 'accountInfoSameAsRequestConfig', 'config.json.basic', errors)
    if (value.basic.accountInfoConfig !== undefined) {
      validateRequestShape(value.basic.accountInfoConfig, 'config.json.basic.accountInfoConfig', errors)
    }
    if (value.basic.accountInfoMapping !== undefined) {
      validateIdentityShape(value.basic.accountInfoMapping, 'config.json.basic.accountInfoMapping', errors)
    }
  }

  if (value.oauth2 !== undefined && validateExactKeys(value.oauth2, OAUTH_KEYS, 'config.json.oauth2', errors)) {
    for (const key of ['externalAppName', 'clientId', 'clientSecret', 'scopes']) {
      requiredString(value.oauth2, key, 'config.json.oauth2', errors)
    }
    requiredBoolean(value.oauth2, 'pkceEnabled', 'config.json.oauth2', errors)
    requiredBoolean(value.oauth2, 'isAutoRefreshTokenEnabled', 'config.json.oauth2', errors)
    requiredBoolean(value.oauth2, 'userInfoSameAsRequestConfig', 'config.json.oauth2', errors)
    validateRequestShape(value.oauth2.authorizationUrlConfig, 'config.json.oauth2.authorizationUrlConfig', errors)
    validateRequestShape(value.oauth2.accessTokenConfig, 'config.json.oauth2.accessTokenConfig', errors)
    if (value.oauth2.longLivedAccessTokenConfig !== undefined) {
      validateRequestShape(value.oauth2.longLivedAccessTokenConfig, 'config.json.oauth2.longLivedAccessTokenConfig', errors)
    }
    if (value.oauth2.refreshTokenConfig !== undefined) {
      validateRequestShape(value.oauth2.refreshTokenConfig, 'config.json.oauth2.refreshTokenConfig', errors)
    }
    if (value.oauth2.userInfoConfig !== undefined) {
      validateRequestShape(value.oauth2.userInfoConfig, 'config.json.oauth2.userInfoConfig', errors)
    }
    if (value.oauth2.userInfoMapping !== undefined) {
      validateIdentityShape(value.oauth2.userInfoMapping, 'config.json.oauth2.userInfoMapping', errors)
    }
    if (value.oauth2.codeMode !== undefined && validateExactKeys(value.oauth2.codeMode, CODE_MODE_STEPS, 'config.json.oauth2.codeMode', errors)) {
      for (const [step, config] of Object.entries(value.oauth2.codeMode)) {
        const path = `config.json.oauth2.codeMode.${step}`
        if (!validateExactKeys(config, CODE_STEP_KEYS, path, errors)) continue
        requiredBoolean(config, 'enabled', path, errors)
        requiredString(config, 'code', path, errors)
      }
    }
  }
  return value.schemaVersion === 1 &&
    typeof value.appId === 'string' &&
    typeof value.versionId === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.updateAllRefreshTokens === 'boolean' &&
    (value.type === 'basic' || value.type === 'oauth2') &&
    Array.isArray(value.fields) && value.fields.every(hasFieldShape) &&
    hasRequestShape(value.requestConfig) &&
    (value.accountDataUri === undefined || typeof value.accountDataUri === 'string') &&
    isRecord(value.capabilities) &&
    typeof value.capabilities.hasWhoAmIApi === 'boolean' &&
    typeof value.capabilities.multiAuthEnabled === 'boolean' &&
    (value.basic === undefined || hasBasicShape(value.basic)) &&
    (value.oauth2 === undefined || hasOAuthShape(value.oauth2))
}

function hasUnsafePathSegment(value: string): boolean {
  return value.split('.').some(segment => UNSAFE_PATH_SEGMENTS.has(segment.toLowerCase()))
}

function validateHumanText(value: string, path: string, errors: string[]): void {
  if (CONTROL_CHARACTERS.test(value)) errors.push(`${path} must not contain control characters.`)
  const result = validateXssSafe(value, path)
  if (result !== true) errors.push(result)
}

function validateSecretValue(value: string, path: string, errors: string[]): void {
  if (value.length === 0 || SECRET_REFERENCE.test(value) || TEMPLATE.test(value)) {
    TEMPLATE.lastIndex = 0
    return
  }
  TEMPLATE.lastIndex = 0
  errors.push(`${path} must use \${env:NAME} or \${remote}; secret literals must not be committed.`)
}

function validateCredentialReference(value: string, path: string, errors: string[]): void {
  if (value.length === 0 || SECRET_REFERENCE.test(value)) return
  errors.push(`${path} must use \${env:NAME} or \${remote}; credential literals must not be committed.`)
}

function isSensitiveKey(value: string): boolean {
  const key = value.trim().toLowerCase()
  return SENSITIVE_KEY_PARTS.some(part => key.includes(part)) || key.split(/[-_.]/).includes('auth')
}

function validateTemplates(value: string, fieldKeys: ReadonlySet<string>, errors: string[]): void {
  for (const match of value.matchAll(TEMPLATE)) {
    const reference = match[1].trim()
    if (reference.startsWith('userData.')) {
      const key = reference.slice('userData.'.length)
      if (!fieldKeys.has(key)) errors.push(`config.json references undefined auth field "${sanitizeTerminalText(key)}".`)
      continue
    }
    if (!reference.startsWith('externalApp.') && !reference.startsWith('bundle.')) {
      errors.push(`config.json contains unsupported template "{{${sanitizeTerminalText(reference)}}}".`)
    }
  }
}

function sensitiveQueryParameters(value: string): string[] {
  try {
    return [...new URL(value).searchParams.keys()].filter(isSensitiveKey)
  } catch {
    return []
  }
}

function validateRequest(
  request: ExternalAuthRequestConfig,
  path: string,
  fieldKeys: ReadonlySet<string>,
  errors: string[],
  options: { allowedMethods?: ReadonlySet<ExternalAuthHttpMethod>; required: boolean }
): void {
  const allowedMethods = options.allowedMethods ?? HTTP_METHODS
  if (!allowedMethods.has(request.method)) {
    errors.push(`${path}.method must be one of: ${[...allowedMethods].join(', ')}.`)
  }
  if ((request.method === 'GET' || request.method === 'HEAD') && request.body.length > 0) {
    errors.push(`${path}.body must be empty for ${request.method} requests.`)
  }

  if (request.url.length === 0) {
    if (options.required) errors.push(`${path}.url is required.`)
  } else if (request.url !== EXTERNAL_AUTH_REMOTE_REFERENCE) {
    validateTemplates(request.url, fieldKeys, errors)
    validateHumanText(request.url, `${path}.url`, errors)
    const candidate = request.url.replace(TEMPLATE, 'placeholder')
    const urlResult = validateHttpUrl(candidate, `${path}.url`, { publicOnly: true })
    if (urlResult !== true) errors.push(urlResult)
    if (sensitiveQueryParameters(request.url).length > 0) {
      errors.push(`${path}.url must place sensitive query parameters in urlParams so their values can use secret references.`)
    }
  }

  for (const section of ['urlParams', 'headers', 'body'] as const) {
    const entries = request[section]
    const seen = new Set<string>()
    entries.forEach((entry: ExternalAuthKeyValue, index: number) => {
      const entryPath = `${path}.${section}[${index}]`
      if (entry.key.trim().length === 0) errors.push(`${entryPath}.key must be non-empty.`)
      validateHumanText(entry.key, `${entryPath}.key`, errors)
      validateHumanText(entry.value, `${entryPath}.value`, errors)
      const normalizedKey = section === 'headers' ? entry.key.toLowerCase() : entry.key
      if (seen.has(normalizedKey)) errors.push(`${entryPath}.key must be unique within ${section}.`)
      seen.add(normalizedKey)
      validateTemplates(entry.value, fieldKeys, errors)

      if (section === 'headers') {
        if (!HEADER_NAME.test(entry.key)) errors.push(`${entryPath}.key must be a valid HTTP header name.`)
        const lowerKey = entry.key.toLowerCase()
        const lowerValue = entry.value.toLowerCase()
        if (lowerKey === 'metadata-flavor' && lowerValue.trim() === 'google') {
          errors.push(`${entryPath} must not set metadata-flavor: Google.`)
        }
        if (lowerKey === 'channel' && lowerValue.trim() === 'istio_mesh') {
          errors.push(`${entryPath} must not set CHANNEL: ISTIO_MESH.`)
        }
        if (isSensitiveKey(lowerKey)) validateSecretValue(entry.value, `${entryPath}.value`, errors)
      } else if (isSensitiveKey(entry.key)) {
        validateSecretValue(entry.value, `${entryPath}.value`, errors)
      }
    })
  }
}

function validateIdentity(
  mapping: { id: string; name: string; email: string } | undefined,
  path: string,
  errors: string[]
): void {
  if (!mapping) {
    errors.push(`${path}.id is required.`)
    errors.push(`${path} must configure at least name or email.`)
    return
  }
  validateIdentitySafety(mapping, path, errors)
  if (!mapping.id.trim()) errors.push(`${path}.id is required.`)
  if (!mapping.name.trim() && !mapping.email.trim()) errors.push(`${path} must configure at least name or email.`)
}

function validateIdentitySafety(
  mapping: { id: string; name: string; email: string } | undefined,
  path: string,
  errors: string[]
): void {
  if (!mapping) return
  for (const [key, value] of Object.entries(mapping)) {
    validateHumanText(value, `${path}.${key}`, errors)
    if (value && hasUnsafePathSegment(value)) errors.push(`${path}.${key} contains an unsafe object path.`)
  }
}

function codeModeEnabled(manifest: ExternalAuthManifest, step: ExternalAuthCodeModeStep): boolean {
  return manifest.oauth2?.codeMode?.[step]?.enabled === true
}

function validateCodeMode(manifest: ExternalAuthManifest, errors: string[]): void {
  for (const [step, config] of Object.entries(manifest.oauth2?.codeMode ?? {})) {
    if (!config?.enabled) continue
    const path = `config.json.oauth2.codeMode.${step}.code`
    if (!config.code.trim()) {
      errors.push(`${path} is required when Code Mode is enabled.`)
      continue
    }
    if (Buffer.byteLength(config.code, 'utf8') > MAX_CODE_BYTES) {
      errors.push(`${path} must be at most ${MAX_CODE_BYTES.toLocaleString('en-US')} bytes.`)
      continue
    }
    const syntaxError = workflowActionCodeSyntaxError(config.code, path)
    if (syntaxError) errors.push(`${path} is invalid: ${syntaxError}`)
  }
}

export function validateExternalAuthManifest(
  value: unknown,
  locks: Partial<ExternalAuthCapabilityLocks> = {}
): string[] {
  const errors: string[] = []
  if (!validateManifestShape(value, errors)) return errors
  const manifest = value

  if (!isAppResourceIdentifier(manifest.appId)) {
    errors.push('config.json.appId must contain only letters and numbers, underscores, or hyphens and be 1 to 128 characters.')
  }
  if (!isAppResourceIdentifier(manifest.versionId)) {
    errors.push('config.json.versionId must contain only letters and numbers, underscores, or hyphens and be 1 to 128 characters.')
  }
  if (manifest.basic && manifest.type !== 'basic') errors.push('config.json.basic is only supported when type is "basic".')
  if (manifest.oauth2 && manifest.type !== 'oauth2') errors.push('config.json.oauth2 is only supported when type is "oauth2".')
  if (manifest.type === 'basic' && !manifest.basic) errors.push('config.json.basic is required when type is "basic".')
  if (manifest.type === 'oauth2' && !manifest.oauth2) errors.push('config.json.oauth2 is required when type is "oauth2".')

  if (manifest.fields.length > 3) errors.push('config.json.fields supports at most 3 auth fields.')
  const fieldKeys = new Set<string>()
  manifest.fields.forEach((field, index) => {
    const path = `config.json.fields[${index}]`
    if (!SAFE_FIELD_KEY.test(field.key) || hasUnsafePathSegment(field.key)) {
      errors.push(`${path}.key must be a safe field key beginning with a letter and containing only letters, numbers, dots, underscores, or hyphens.`)
    }
    if (fieldKeys.has(field.key)) errors.push(`${path}.key must be unique.`)
    fieldKeys.add(field.key)
    if (!field.label.trim()) errors.push(`${path}.label is required.`)
    validateHumanText(field.label, `${path}.label`, errors)
    validateHumanText(field.helpText, `${path}.helpText`, errors)
    validateHumanText(field.defaultValue, `${path}.defaultValue`, errors)
    if ((field.type === 'password' || isSensitiveKey(field.key)) && field.defaultValue) {
      validateCredentialReference(field.defaultValue, `${path}.defaultValue`, errors)
    }
  })

  if (locks.hasWhoAmIApiDisableLocked && !manifest.capabilities.hasWhoAmIApi) {
    errors.push('Who Am I capability cannot be disabled because a published version already uses it.')
  }
  if (locks.multiAuthEnabledDisableLocked && !manifest.capabilities.multiAuthEnabled) {
    errors.push('Multi-auth capability cannot be disabled because a published version already uses it.')
  }
  if (locks.oauth2TypeLocked && manifest.type !== 'oauth2') {
    errors.push('Authentication type cannot be changed from OAuth 2 because an app version already uses OAuth 2.')
  }

  const required = manifest.enabled
  validateRequest(manifest.requestConfig, 'config.json.requestConfig', fieldKeys, errors, {
    allowedMethods: manifest.type === 'basic' ? BASIC_METHODS : HTTP_METHODS,
    required: required && !codeModeEnabled(manifest, 'testRequest')
  })
  if (manifest.accountDataUri && manifest.accountDataUri !== EXTERNAL_AUTH_REMOTE_REFERENCE) {
    validateHumanText(manifest.accountDataUri, 'config.json.accountDataUri', errors)
    validateTemplates(manifest.accountDataUri, fieldKeys, errors)
    const uriResult = validateHttpUrl(manifest.accountDataUri.replace(TEMPLATE, 'placeholder'), 'config.json.accountDataUri', {
      publicOnly: true
    })
    if (uriResult !== true) errors.push(uriResult)
    if (sensitiveQueryParameters(manifest.accountDataUri).length > 0) {
      errors.push('config.json.accountDataUri must not contain sensitive query parameters.')
    }
  }

  if (manifest.type === 'basic') {
    const basic = manifest.basic
    if (!basic) return [...new Set(errors)]
    if (basic.accountInfoConfig) {
      validateRequest(basic.accountInfoConfig, 'config.json.basic.accountInfoConfig', fieldKeys, errors, {
        allowedMethods: BASIC_METHODS,
        required: required && manifest.capabilities.hasWhoAmIApi && !basic.accountInfoSameAsRequestConfig
      })
    }
    validateIdentitySafety(basic.accountInfoMapping, 'config.json.basic.accountInfoMapping', errors)
    if (!required) return [...new Set(errors)]
    if (manifest.fields.length === 0) errors.push('config.json.fields requires at least one field for Basic authentication.')
    if (!manifest.fields.some(field => field.required)) {
      errors.push('config.json.fields requires at least one required field for Basic authentication.')
    }
    if (manifest.capabilities.hasWhoAmIApi) {
      if (!basic.accountInfoSameAsRequestConfig && !basic.accountInfoConfig) {
        errors.push('config.json.basic.accountInfoConfig is required when Who Am I uses a separate request.')
      }
      validateIdentity(basic.accountInfoMapping, 'config.json.basic.accountInfoMapping', errors)
    }
    return [...new Set(errors)]
  }

  const oauth = manifest.oauth2
  if (!oauth) return [...new Set(errors)]
  validateHumanText(oauth.externalAppName, 'config.json.oauth2.externalAppName', errors)
  if (oauth.clientId) validateCredentialReference(oauth.clientId, 'config.json.oauth2.clientId', errors)
  if (oauth.clientSecret) validateCredentialReference(oauth.clientSecret, 'config.json.oauth2.clientSecret', errors)
  validateHumanText(oauth.scopes, 'config.json.oauth2.scopes', errors)

  validateRequest(oauth.authorizationUrlConfig, 'config.json.oauth2.authorizationUrlConfig', fieldKeys, errors, {
    allowedMethods: new Set(['GET']),
    required: required && !codeModeEnabled(manifest, 'authorizationUrl')
  })
  validateRequest(oauth.accessTokenConfig, 'config.json.oauth2.accessTokenConfig', fieldKeys, errors, {
    required: required && !codeModeEnabled(manifest, 'accessTokenRequest')
  })
  if (oauth.longLivedAccessTokenConfig) {
    validateRequest(oauth.longLivedAccessTokenConfig, 'config.json.oauth2.longLivedAccessTokenConfig', fieldKeys, errors, {
      required
    })
  }
  if (required && oauth.isAutoRefreshTokenEnabled && !oauth.refreshTokenConfig && !codeModeEnabled(manifest, 'refreshTokenRequest')) {
    errors.push('config.json.oauth2.refreshTokenConfig is required when auto-refresh is enabled.')
  }
  if (oauth.refreshTokenConfig) {
    validateRequest(oauth.refreshTokenConfig, 'config.json.oauth2.refreshTokenConfig', fieldKeys, errors, {
      required: required && oauth.isAutoRefreshTokenEnabled && !codeModeEnabled(manifest, 'refreshTokenRequest')
    })
  }
  validateCodeMode(manifest, errors)

  if (oauth.userInfoConfig) {
    validateRequest(oauth.userInfoConfig, 'config.json.oauth2.userInfoConfig', fieldKeys, errors, {
      allowedMethods: BASIC_METHODS,
      required: required && manifest.capabilities.hasWhoAmIApi &&
        !oauth.userInfoSameAsRequestConfig && !codeModeEnabled(manifest, 'userInfoRequest')
    })
  }
  validateIdentitySafety(oauth.userInfoMapping, 'config.json.oauth2.userInfoMapping', errors)
  if (!required) return [...new Set(errors)]

  if (!oauth.externalAppName.trim()) errors.push('config.json.oauth2.externalAppName is required.')
  if (!oauth.clientId.trim()) errors.push('config.json.oauth2.clientId is required.')
  if (!oauth.pkceEnabled && !oauth.clientSecret.trim()) errors.push('config.json.oauth2.clientSecret is required unless PKCE is enabled.')
  if (!oauth.scopes.trim()) errors.push('config.json.oauth2.scopes is required.')

  if (manifest.capabilities.hasWhoAmIApi) {
    if (!oauth.userInfoSameAsRequestConfig && !oauth.userInfoConfig && !codeModeEnabled(manifest, 'userInfoRequest')) {
      errors.push('config.json.oauth2.userInfoConfig is required when Who Am I uses a separate request.')
    }
    validateIdentity(oauth.userInfoMapping, 'config.json.oauth2.userInfoMapping', errors)
  }
  return [...new Set(errors)]
}

export function isExternalAuthSecretReference(value: string): boolean {
  return value === EXTERNAL_AUTH_REMOTE_REFERENCE || EXTERNAL_AUTH_ENV_REFERENCE.test(value)
}
