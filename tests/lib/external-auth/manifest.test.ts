import { describe, expect, it } from 'vitest'

import {
  buildExternalAuthManifest,
  ExternalAuthManifest,
  prepareExternalAuthUpdateBody
} from '../../../src/lib/external-auth/manifest.js'

function oauthResponse() {
  return {
    hasExternalAuth: true,
    updateAllRefreshTokens: true,
    externalAuthConfig: {
      type: 'oauth2',
      fields: [
        {
          key: 'region',
          label: 'Region',
          required: true,
          type: 'text',
          helpText: 'Provider region',
          defaultValue: 'us-east-1',
          toBeShownForAgencyInstallation: true
        },
        {
          key: 'api_key',
          label: 'API key',
          required: true,
          type: 'password',
          helpText: 'Provider API key',
          defaultValue: 'field-secret',
          toBeShownForAgencyInstallation: false
        }
      ],
      requestConfig: {
        url: 'https://api.example.com/me?api_key=url-secret',
        method: 'GET',
        urlParams: [{ key: 'region', value: '{{userData.region}}' }],
        headers: [
          { key: 'Authorization', value: 'Bearer runtime-secret' },
          { key: 'Accept', value: 'application/json' }
        ],
        body: []
      },
      hasWhoAmIApi: true,
      multiAuthEnabled: true,
      allowManualMultiAuth: false,
      resolvedCapabilities: { hasWhoAmIApi: true, multiAuthEnabled: true },
      capabilityLocks: { hasWhoAmIApiDisableLocked: true, multiAuthEnabledDisableLocked: false },
      accountDataUri: 'https://api.example.com/account?access_token=account-secret',
      userInfoConfig: {
        url: 'https://api.example.com/user',
        method: 'GET',
        urlParams: [],
        headers: [{ key: 'Authorization', value: 'Bearer {{bundle.accessToken}}' }],
        body: []
      },
      userInfoMapping: { id: 'data.id', name: 'data.name', email: 'data.email' },
      codeMode: { testRequest: { enabled: true, code: 'return { ok: true }' } },
      tokenManagement: {
        name: 'Example',
        clientId: 'public-client',
        clientSecret: 'oauth-secret',
        scopes: 'read,write',
        pkceEnabled: false,
        authorizationUrlConfig: {
          url: 'https://accounts.example.com/oauth/authorize',
          method: 'GET',
          urlParams: [{ key: 'client_id', value: '{{externalApp.clientId}}' }],
          headers: [],
          body: []
        },
        accessTokenConfig: {
          url: 'https://accounts.example.com/oauth/token',
          method: 'POST',
          urlParams: [],
          headers: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
          body: [{ key: 'client_secret', value: 'nested-secret' }]
        },
        longLivedAccessTokenConfig: {
          url: 'https://accounts.example.com/oauth/long-lived',
          method: 'POST',
          urlParams: [],
          headers: [],
          body: [{ key: 'access_token', value: '{{bundle.accessToken}}' }]
        },
        refreshTokenConfig: {
          url: 'https://accounts.example.com/oauth/token',
          method: 'POST',
          urlParams: [],
          headers: [],
          body: [{ key: 'refresh_token', value: '{{bundle.refreshToken}}' }]
        },
        isAutoRefreshTokenEnabled: true,
        userInfoSameAsRequestConfig: false
      }
    }
  } as const
}

describe('external auth manifest mapping', () => {
  it('maps every OAuth form option while redacting secret-bearing values', () => {
    const manifest = buildExternalAuthManifest('app-1', 'version-1', oauthResponse())

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      appId: 'app-1',
      versionId: 'version-1',
      enabled: true,
      updateAllRefreshTokens: true,
      type: 'oauth2',
      capabilities: { hasWhoAmIApi: true, multiAuthEnabled: true },
      oauth2: {
        externalAppName: 'Example',
        clientId: '${remote}',
        clientSecret: '${remote}',
        scopes: 'read,write',
        pkceEnabled: false,
        isAutoRefreshTokenEnabled: true,
        userInfoSameAsRequestConfig: false,
        userInfoMapping: { id: 'data.id', name: 'data.name', email: 'data.email' },
        codeMode: { testRequest: { enabled: true, code: 'return { ok: true }' } }
      }
    })
    expect(manifest.fields[1].defaultValue).toBe('${remote}')
    expect(manifest.requestConfig.url).toBe('${remote}')
    expect(manifest.accountDataUri).toBe('${remote}')
    expect(manifest.requestConfig.headers).toEqual([
      { key: 'Authorization', value: '${remote}' },
      { key: 'Accept', value: 'application/json' }
    ])
    expect(manifest.oauth2?.accessTokenConfig.body).toEqual([{ key: 'client_secret', value: '${remote}' }])
    expect(JSON.stringify(manifest)).not.toMatch(/public-client|oauth-secret|field-secret|runtime-secret|nested-secret|url-secret|account-secret/)
    expect(manifest).not.toHaveProperty('externalAuthConfig')
  })

  it('resolves environment and remote references into the flattened backend payload', () => {
    const manifest = buildExternalAuthManifest('app-1', 'version-1', oauthResponse())
    manifest.oauth2!.clientId = '${env:PROVIDER_CLIENT_ID}'
    manifest.oauth2!.clientSecret = '${env:PROVIDER_CLIENT_SECRET}'
    manifest.fields[1].defaultValue = '${remote}'
    manifest.requestConfig.headers[0].value = '${env:PROVIDER_AUTH_HEADER}'

    const body = prepareExternalAuthUpdateBody(manifest, oauthResponse(), {
      PROVIDER_CLIENT_ID: 'replacement-client-id',
      PROVIDER_CLIENT_SECRET: 'replacement-secret',
      PROVIDER_AUTH_HEADER: 'Bearer replacement-token'
    })

    expect(body).toMatchObject({
      hasExternalAuth: true,
      updateAllRefreshTokens: true,
      type: 'oauth2',
      clientId: 'replacement-client-id',
      clientSecret: 'replacement-secret',
      externalAppName: 'Example',
      hasWhoAmIApi: true,
      multiAuthEnabled: true,
      userInfoSameAsRequestConfig: false
    })
    expect(body.fields[1].defaultValue).toBe('field-secret')
    expect(body.requestConfig.headers[0].value).toBe('Bearer replacement-token')
    expect(body.requestConfig.url).toBe('https://api.example.com/me?api_key=url-secret')
    expect(body.accountDataUri).toBe('https://api.example.com/account?access_token=account-secret')
    expect(body.accessTokenConfig.body[0].value).toBe('nested-secret')
    expect(body).not.toHaveProperty('capabilities')
    expect(body).not.toHaveProperty('allowManualMultiAuth')
    expect(manifest.oauth2!.clientId).toBe('${env:PROVIDER_CLIENT_ID}')
    expect(manifest.oauth2!.clientSecret).toBe('${env:PROVIDER_CLIENT_SECRET}')
  })

  it('maps Basic auth identity configuration and omits OAuth-only fields', () => {
    const response = {
      hasExternalAuth: true,
      externalAuthConfig: {
        type: 'basic',
        fields: [{
          key: 'api_key',
          label: 'API key',
          required: true,
          type: 'password',
          helpText: '',
          defaultValue: '',
          toBeShownForAgencyInstallation: true
        }],
        requestConfig: {
          url: 'https://api.example.com/verify',
          method: 'POST',
          urlParams: [],
          headers: [{ key: 'X-Api-Key', value: '{{userData.api_key}}' }],
          body: []
        },
        hasWhoAmIApi: true,
        multiAuthEnabled: true,
        accountInfoSameAsRequestConfig: true,
        accountInfoMapping: { id: 'account.id', name: 'account.name' }
      }
    } as const

    const manifest = buildExternalAuthManifest('app-1', 'version-1', response)
    const body = prepareExternalAuthUpdateBody(manifest, response, {})

    expect(manifest.basic).toEqual({
      accountInfoSameAsRequestConfig: true,
      accountInfoMapping: { id: 'account.id', name: 'account.name', email: '' }
    })
    expect(manifest).not.toHaveProperty('oauth2')
    expect(body).toMatchObject({
      type: 'basic',
      accountInfoSameAsRequestConfig: true,
      accountInfoMapping: { id: 'account.id', name: 'account.name', email: '' }
    })
    expect(body).not.toHaveProperty('accountInfoConfig')
  })

  it('sends the verification request as OAuth user info when the portal reuse option is enabled', () => {
    const manifest = buildExternalAuthManifest('app-1', 'version-1', oauthResponse())
    manifest.oauth2!.userInfoSameAsRequestConfig = true
    const body = prepareExternalAuthUpdateBody(manifest, oauthResponse(), {})

    expect(body.userInfoSameAsRequestConfig).toBe(true)
    expect(body.userInfoConfig).toEqual(body.requestConfig)
  })

  it('does not persist an empty default user-info request', () => {
    const response = oauthResponse() as any
    delete response.externalAuthConfig.userInfoConfig
    const manifest = buildExternalAuthManifest('app-1', 'version-1', response)
    const body = prepareExternalAuthUpdateBody(manifest, response, {})

    expect(manifest.oauth2?.userInfoConfig?.url).toBe('')
    expect(body).not.toHaveProperty('userInfoConfig')
  })

  it('fails closed when a secret reference cannot be resolved', () => {
    const manifest = buildExternalAuthManifest('app-1', 'version-1', oauthResponse())
    manifest.oauth2!.clientSecret = '${env:MISSING_SECRET}'
    expect(() => prepareExternalAuthUpdateBody(manifest, oauthResponse(), {})).toThrow(/MISSING_SECRET/)

    manifest.oauth2!.clientSecret = '${remote}'
    const noRemoteSecret = oauthResponse() as any
    noRemoteSecret.externalAuthConfig.tokenManagement.clientSecret = ''
    expect(() => prepareExternalAuthUpdateBody(manifest, noRemoteSecret, {})).toThrow(/remote.*clientSecret/i)

    manifest.oauth2!.clientId = '${remote}'
    noRemoteSecret.externalAuthConfig.tokenManagement.clientId = ''
    expect(() => prepareExternalAuthUpdateBody(manifest, noRemoteSecret, {})).toThrow(/remote.*clientId/i)
  })
})
