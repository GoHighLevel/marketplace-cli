import { describe, expect, it } from 'vitest'

import { ExternalAuthManifest } from '../../../src/lib/external-auth/manifest.js'
import { validateExternalAuthManifest } from '../../../src/lib/external-auth/schema.js'

function request(url = 'https://api.example.com/verify', method = 'POST') {
  return { url, method, urlParams: [], headers: [], body: [] }
}

function basicManifest(): ExternalAuthManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    versionId: 'version-1',
    enabled: true,
    updateAllRefreshTokens: false,
    type: 'basic',
    fields: [{
      key: 'api_key',
      label: 'API key',
      required: true,
      type: 'password',
      helpText: 'Paste the provider API key',
      defaultValue: '',
      toBeShownForAgencyInstallation: true
    }],
    requestConfig: {
      ...request(),
      headers: [{ key: 'X-Api-Key', value: '{{userData.api_key}}' }]
    },
    capabilities: { hasWhoAmIApi: false, multiAuthEnabled: false },
    basic: { accountInfoSameAsRequestConfig: false }
  }
}

function oauthManifest(): ExternalAuthManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    versionId: 'version-1',
    enabled: true,
    updateAllRefreshTokens: false,
    type: 'oauth2',
    fields: [],
    requestConfig: {
      ...request('https://api.example.com/me', 'GET'),
      headers: [{ key: 'Authorization', value: 'Bearer {{bundle.accessToken}}' }]
    },
    capabilities: { hasWhoAmIApi: false, multiAuthEnabled: false },
    oauth2: {
      externalAppName: 'Example',
      clientId: '${env:PROVIDER_CLIENT_ID}',
      clientSecret: '${env:PROVIDER_CLIENT_SECRET}',
      scopes: 'read write',
      pkceEnabled: false,
      authorizationUrlConfig: request('https://accounts.example.com/oauth/authorize', 'GET'),
      accessTokenConfig: request('https://accounts.example.com/oauth/token'),
      refreshTokenConfig: request('https://accounts.example.com/oauth/token'),
      isAutoRefreshTokenEnabled: true,
      userInfoSameAsRequestConfig: false
    }
  }
}

describe('external auth schema', () => {
  it('accepts complete Basic and OAuth configurations', () => {
    expect(validateExternalAuthManifest(basicManifest())).toEqual([])
    expect(validateExternalAuthManifest(oauthManifest())).toEqual([])
  })

  it('accepts incomplete configuration only while external auth is disabled', () => {
    const manifest = oauthManifest()
    manifest.enabled = false
    manifest.oauth2!.externalAppName = ''
    manifest.oauth2!.clientId = ''
    manifest.oauth2!.clientSecret = ''
    manifest.oauth2!.scopes = ''
    manifest.oauth2!.authorizationUrlConfig = request('', 'GET')
    manifest.oauth2!.accessTokenConfig = request('')
    manifest.requestConfig = request('', 'GET')
    expect(validateExternalAuthManifest(manifest)).toEqual([])
  })

  it('still rejects unsafe persisted values while external auth is disabled', () => {
    const manifest = oauthManifest()
    manifest.enabled = false
    manifest.oauth2!.clientId = 'plaintext-client-id'
    manifest.oauth2!.clientSecret = 'plaintext-client-secret'
    manifest.oauth2!.scopes = '<img src=x onerror=alert(1)>'

    expect(validateExternalAuthManifest(manifest)).toEqual(expect.arrayContaining([
      expect.stringMatching(/clientId.*credential literals/i),
      expect.stringMatching(/clientSecret.*credential literals/i),
      expect.stringMatching(/scopes.*dangerous/i)
    ]))
  })

  it('rejects unknown properties, cross-type sections, and invalid bindings', () => {
    const manifest = basicManifest() as any
    manifest.injected = true
    manifest.oauth2 = oauthManifest().oauth2
    manifest.appId = '../other-app'
    const errors = validateExternalAuthManifest(manifest)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/injected.*not.*supported/i),
      expect.stringMatching(/oauth2.*only supported/i),
      expect.stringMatching(/appId.*letters.*numbers/i)
    ]))
  })

  it('returns schema errors instead of throwing for malformed untrusted JSON', () => {
    const malformed = {
      schemaVersion: 1,
      appId: 'app-1',
      versionId: 'version-1',
      enabled: true,
      updateAllRefreshTokens: false,
      type: 'basic',
      fields: null,
      requestConfig: 'not-an-object',
      capabilities: [],
      basic: { accountInfoSameAsRequestConfig: 'yes' }
    }
    expect(() => validateExternalAuthManifest(malformed)).not.toThrow()
    expect(validateExternalAuthManifest(malformed)).toEqual(expect.arrayContaining([
      'config.json.fields must be an array.',
      'config.json.requestConfig must be an object.',
      'config.json.capabilities must be an object.',
      'config.json.basic.accountInfoSameAsRequestConfig must be a boolean.'
    ]))
  })

  it('rejects XSS, unsafe URLs, header injection, and internal-service headers', () => {
    const manifest = basicManifest()
    manifest.fields[0].helpText = '<img src=x onerror=alert(1)>'
    manifest.requestConfig.url = 'http://127.0.0.1/latest/meta-data'
    manifest.requestConfig.body = [{ key: 'payload', value: '<svg onload=alert(1)>' }]
    manifest.requestConfig.headers = [
      { key: 'X-Test\r\nInjected', value: 'value' },
      { key: 'metadata-flavor', value: 'Google' },
      { key: 'CHANNEL', value: 'ISTIO_MESH' }
    ]
    const errors = validateExternalAuthManifest(manifest)
    expect(errors.filter(error => /dangerous/i.test(error))).toHaveLength(2)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/helpText.*dangerous/i),
      expect.stringMatching(/public internet host/i),
      expect.stringMatching(/header name/i),
      expect.stringMatching(/metadata-flavor/i),
      expect.stringMatching(/ISTIO_MESH/i)
    ]))
  })

  it('requires references for secret-bearing literals and validates userData templates', () => {
    const manifest = basicManifest()
    manifest.fields[0].defaultValue = 'do-not-commit-me'
    manifest.requestConfig.headers[0].value = 'literal-api-key'
    manifest.requestConfig.body.push({ key: 'password', value: 'literal-password' })
    manifest.requestConfig.urlParams.push({ key: 'region', value: '{{userData.missing}}' })
    const errors = validateExternalAuthManifest(manifest)
    expect(errors.filter(error => /\$\{env:NAME\}|\$\{remote\}/.test(error))).toHaveLength(3)
    expect(errors).toContain('config.json references undefined auth field "missing".')
  })

  it('allows non-secret custom headers but rejects sensitive query strings embedded in URLs', () => {
    const manifest = basicManifest()
    manifest.requestConfig.headers.push({ key: 'X-API-Version', value: '2026-09' })
    expect(validateExternalAuthManifest(manifest)).toEqual([])

    manifest.requestConfig.url = 'https://api.example.com/verify?api_key=literal-secret'
    expect(validateExternalAuthManifest(manifest)).toContain(
      'config.json.requestConfig.url must place sensitive query parameters in urlParams so their values can use secret references.'
    )
  })

  it('enforces field limits, safe unique keys, and complete key/value entries', () => {
    const manifest = basicManifest()
    manifest.fields[0].label = '   '
    manifest.fields.push(
      { ...manifest.fields[0], key: 'api_key' },
      { ...manifest.fields[0], key: '__proto__.token' },
      { ...manifest.fields[0], key: 'fourth' }
    )
    manifest.requestConfig.urlParams = [{ key: '', value: 'value' }]
    const errors = validateExternalAuthManifest(manifest)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/at most 3/i),
      expect.stringMatching(/label.*required/i),
      expect.stringMatching(/must be unique/i),
      expect.stringMatching(/safe field key/i),
      expect.stringMatching(/urlParams\[0\]\.key.*non-empty/i)
    ]))
  })

  it('enforces request methods, GET body rules, and OAuth conditional fields', () => {
    const manifest = oauthManifest()
    manifest.oauth2!.authorizationUrlConfig.method = 'POST'
    manifest.oauth2!.accessTokenConfig.method = 'GET'
    manifest.oauth2!.accessTokenConfig.body = [{ key: 'code', value: '{{bundle.code}}' }]
    delete manifest.oauth2!.refreshTokenConfig
    const errors = validateExternalAuthManifest(manifest)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/authorizationUrlConfig\.method.*GET/i),
      expect.stringMatching(/accessTokenConfig.*body.*GET/i),
      expect.stringMatching(/refreshTokenConfig.*auto-refresh/i)
    ]))
  })

  it('supports PKCE and form replacement through valid code-mode steps', () => {
    const manifest = oauthManifest()
    manifest.oauth2!.pkceEnabled = true
    manifest.oauth2!.clientSecret = ''
    manifest.oauth2!.authorizationUrlConfig = request('', 'GET')
    manifest.oauth2!.accessTokenConfig = request('')
    manifest.requestConfig = request('', 'GET')
    manifest.oauth2!.isAutoRefreshTokenEnabled = true
    delete manifest.oauth2!.refreshTokenConfig
    manifest.oauth2!.codeMode = {
      authorizationUrl: { enabled: true, code: 'return "https://accounts.example.com/oauth/authorize"' },
      accessTokenRequest: { enabled: true, code: 'return z.request({ url: "https://accounts.example.com/token" })' },
      refreshTokenRequest: { enabled: true, code: 'return z.request({ url: "https://accounts.example.com/token" })' },
      testRequest: { enabled: true, code: 'return { ok: true }' }
    }
    expect(validateExternalAuthManifest(manifest)).toEqual([])

    manifest.oauth2!.codeMode.testRequest!.code = ''
    expect(validateExternalAuthManifest(manifest)).toContain(
      'config.json.oauth2.codeMode.testRequest.code is required when Code Mode is enabled.'
    )
  })

  it('validates Basic and OAuth user-info identity mappings and sticky capabilities', () => {
    const basic = basicManifest()
    basic.capabilities = { hasWhoAmIApi: true, multiAuthEnabled: true }
    basic.basic = { accountInfoSameAsRequestConfig: false }
    expect(validateExternalAuthManifest(basic)).toEqual(expect.arrayContaining([
      expect.stringMatching(/accountInfoConfig/i),
      expect.stringMatching(/accountInfoMapping\.id/i),
      expect.stringMatching(/name or.*email/i)
    ]))

    const oauth = oauthManifest()
    oauth.capabilities = { hasWhoAmIApi: true, multiAuthEnabled: true }
    oauth.oauth2!.userInfoSameAsRequestConfig = false
    expect(validateExternalAuthManifest(oauth, {
      hasWhoAmIApiDisableLocked: true,
      multiAuthEnabledDisableLocked: true
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/userInfoConfig/i),
      expect.stringMatching(/userInfoMapping\.id/i),
      expect.stringMatching(/name or.*email/i)
    ]))

    oauth.capabilities = { hasWhoAmIApi: false, multiAuthEnabled: false }
    expect(validateExternalAuthManifest(oauth, {
      hasWhoAmIApiDisableLocked: true,
      multiAuthEnabledDisableLocked: true
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/Who Am I.*cannot be disabled/i),
      expect.stringMatching(/Multi-auth.*cannot be disabled/i)
    ]))

    const basicAfterOAuth = basicManifest()
    expect(validateExternalAuthManifest(basicAfterOAuth, {
      authTypeLocked: true,
      lockedAuthType: 'oauth2'
    })).toContain(
      'Authentication type cannot be changed from OAuth 2 because a published version already uses it.'
    )

    const oauthAfterBasic = oauthManifest()
    expect(validateExternalAuthManifest(oauthAfterBasic, {
      authTypeLocked: true,
      lockedAuthType: 'basic'
    })).toContain(
      'Authentication type cannot be changed from Basic because a published version already uses it.'
    )
  })
})
