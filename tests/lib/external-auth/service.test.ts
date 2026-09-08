import { describe, expect, it, vi } from 'vitest'

import {
  externalAuthTestIdFromState,
  externalAuthManifestsEquivalent,
  fetchExternalAuthSnapshot,
  pollExternalAuthTest,
  redactExternalAuthTestOutput,
  resolveExternalAuthLocks,
  validateExternalAuthTestUserData
} from '../../../src/lib/external-auth/service.js'
import { ExternalAuthField } from '../../../src/lib/external-auth/manifest.js'

describe('external auth service', () => {
  it('fetches a redacted manifest without retaining decrypted credentials', async () => {
    const client = {
      getExternalAuthConfig: vi.fn().mockResolvedValue({
        hasExternalAuth: true,
        externalAuthConfig: {
          type: 'oauth2',
          fields: [],
          requestConfig: { url: 'https://api.example.com/me', method: 'GET', urlParams: [], headers: [], body: [] },
          tokenManagement: {
            name: 'Example',
            clientId: 'client-id',
            clientSecret: 'plain-secret',
            scopes: 'read',
            pkceEnabled: false,
            authorizationUrlConfig: { url: 'https://example.com/auth', method: 'GET', urlParams: [], headers: [], body: [] },
            accessTokenConfig: { url: 'https://example.com/token', method: 'POST', urlParams: [], headers: [], body: [] },
            isAutoRefreshTokenEnabled: false,
            userInfoSameAsRequestConfig: false
          }
        }
      })
    }

    const snapshot = await fetchExternalAuthSnapshot(client, 'app-1', 'version-1')
    expect(snapshot.manifest.oauth2?.clientId).toBe('${remote}')
    expect(snapshot.manifest.oauth2?.clientSecret).toBe('${remote}')
    expect(JSON.stringify(snapshot.manifest)).not.toMatch(/client-id|plain-secret/)
    expect(snapshot.raw.externalAuthConfig?.tokenManagement?.clientId).toBe('client-id')
    expect(snapshot.raw.externalAuthConfig?.tokenManagement?.clientSecret).toBe('plain-secret')
  })

  it('validates test data against configured fields and required values', () => {
    const fields: ExternalAuthField[] = [
      {
        key: 'api_key',
        label: 'API key',
        required: true,
        type: 'password',
        helpText: '',
        defaultValue: '',
        toBeShownForAgencyInstallation: true
      },
      {
        key: 'region',
        label: 'Region',
        required: false,
        type: 'text',
        helpText: '',
        defaultValue: 'us',
        toBeShownForAgencyInstallation: true
      }
    ]
    expect(validateExternalAuthTestUserData(fields, { api_key: 'secret' })).toEqual({ api_key: 'secret' })
    expect(() => validateExternalAuthTestUserData(fields, {})).toThrow(/api_key.*required/i)
    expect(() => validateExternalAuthTestUserData(fields, { unexpected: 'value', api_key: 'secret' })).toThrow(/unexpected/i)
    expect(() => validateExternalAuthTestUserData(fields, { ['bad\u001B[31m']: 'value', api_key: 'secret' }))
      .toThrow('External-auth test input field "bad" is not configured.')
    expect(() => validateExternalAuthTestUserData(fields, { api_key: { nested: true } })).toThrow(/string/i)
    const injectedHeaderValue = 'bad\r\nheader'
    expect(() => validateExternalAuthTestUserData(fields, { [fields[0].key]: injectedHeaderValue }))
      .toThrow(/control characters/i)
  })

  it('extracts only a valid UUID from OAuth state', () => {
    const uuid = 'e1f345b9-4a73-44c0-9063-616d02e5f8d1'
    const state = Buffer.from(JSON.stringify({ uuid, type: 'test' })).toString('base64url')
    expect(externalAuthTestIdFromState(state)).toBe(uuid)
    expect(() => externalAuthTestIdFromState(Buffer.from('{"uuid":"../bad"}').toString('base64url'))).toThrow(/test result id/i)
    expect(() => externalAuthTestIdFromState('not-base64')).toThrow(/OAuth test state/i)
  })

  it('polls until completion with a bounded number of reads', async () => {
    const client = {
      getExternalAuthTestResult: vi.fn()
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'completed', result: { requestConfig: { data: { ok: true } } } })
    }
    const wait = vi.fn().mockResolvedValue(undefined)
    await expect(pollExternalAuthTest(client, 'app-1', 'e1f345b9-4a73-44c0-9063-616d02e5f8d1', {
      timeoutMs: 1_000,
      intervalMs: 10,
      wait
    })).resolves.toEqual({ requestConfig: { data: { ok: true } } })
    expect(client.getExternalAuthTestResult).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledOnce()
  })

  it('resolves the portal OAuth type lock across every app version', async () => {
    const current = {
      hasExternalAuth: false,
      externalAuthConfig: {
        type: 'basic' as const,
        capabilityLocks: { hasWhoAmIApiDisableLocked: true, multiAuthEnabledDisableLocked: false }
      }
    }
    const client = {
      listVersions: vi.fn().mockResolvedValue([{ _id: 'version-1' }, { _id: 'version-2' }]),
      getExternalAuthConfig: vi.fn().mockResolvedValue({ externalAuthConfig: { type: 'oauth2' } })
    }

    await expect(resolveExternalAuthLocks(client, 'app-1', {
      versionId: 'version-1',
      response: current
    })).resolves.toEqual({
      hasWhoAmIApiDisableLocked: true,
      multiAuthEnabledDisableLocked: false,
      oauth2TypeLocked: true
    })
    expect(client.getExternalAuthConfig).toHaveBeenCalledTimes(1)
    expect(client.getExternalAuthConfig).toHaveBeenCalledWith('app-1', 'version-2')
  })

  it('redacts credentials from test diagnostics before returning them to the terminal', () => {
    const result = redactExternalAuthTestOutput({
      requestHeaders: { Authorization: 'Bearer super-secret', Accept: 'application/json' },
      requestData: 'api_key=super-secret',
      responseData: { ok: true, access_token: 'provider-token' },
      trace: 'received provider-token',
      codeModeLogs: [{ step: 'testRequest', logs: ['super-secret', 'unclassified diagnostic'] }]
    }, ['super-secret'])

    expect(result).toEqual({
      requestHeaders: { Authorization: '[REDACTED]', Accept: 'application/json' },
      requestData: 'api_key=[REDACTED]',
      responseData: { ok: true, access_token: '[REDACTED]' },
      trace: 'received [REDACTED]',
      codeModeLogs: [{ step: 'testRequest', logs: ['[REDACTED]', '[REDACTED]'] }]
    })
    expect(JSON.stringify(result)).not.toMatch(/super-secret|provider-token|unclassified diagnostic/)
  })

  it('treats environment and remote secret markers as equivalent after push verification', () => {
    const left = {
      oauth2: { clientSecret: '${env:PROVIDER_SECRET}' },
      requestConfig: { headers: [{ key: 'Authorization', value: '${env:PROVIDER_HEADER}' }] }
    }
    const right = {
      oauth2: { clientSecret: '${remote}' },
      requestConfig: { headers: [{ key: 'Authorization', value: '${remote}' }] }
    }
    expect(externalAuthManifestsEquivalent(left, right)).toBe(true)
  })
})
