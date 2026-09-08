import { describe, expect, it } from 'vitest'

import { ExternalAuthManifest } from '../../../src/lib/external-auth/manifest.js'
import { planExternalAuthSync } from '../../../src/lib/external-auth/sync.js'

function manifest(): ExternalAuthManifest {
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
    capabilities: { hasWhoAmIApi: false, multiAuthEnabled: false },
    basic: { accountInfoSameAsRequestConfig: false }
  }
}

describe('external auth synchronization', () => {
  it('merges non-overlapping local and portal changes into one update', () => {
    const baseline = manifest()
    const local = structuredClone(baseline)
    const remote = structuredClone(baseline)
    local.fields[0].label = 'Provider API key'
    remote.requestConfig.url = 'https://api.example.com/v2/verify'

    const plan = planExternalAuthSync(baseline, local, remote)
    expect(plan.conflicts).toEqual([])
    expect(plan.localChanges).toContain('fields')
    expect(plan.remoteChanges).toContain('requestConfig.url')
    expect(plan.desired).toMatchObject({
      fields: [{ label: 'Provider API key' }],
      requestConfig: { url: 'https://api.example.com/v2/verify' }
    })
    expect(plan.updateRequired).toBe(true)
  })

  it('detects overlapping portal edits and immutable identity changes', () => {
    const baseline = manifest()
    const local = structuredClone(baseline)
    const remote = structuredClone(baseline)
    local.requestConfig.url = 'https://local.example.com/verify'
    remote.requestConfig.url = 'https://portal.example.com/verify'
    local.versionId = 'other-version'

    const plan = planExternalAuthSync(baseline, local, remote)
    expect(plan.conflicts).toContain('requestConfig.url')
    expect(plan.errors).toContain('config.json.versionId is immutable; run `ghl app external-auth pull` for another version.')
    expect(plan.updateRequired).toBe(false)
  })

  it('accepts the same value when it was independently changed locally and remotely', () => {
    const baseline = manifest()
    const local = structuredClone(baseline)
    const remote = structuredClone(baseline)
    local.requestConfig.url = 'https://api.example.com/v2/verify'
    remote.requestConfig.url = 'https://api.example.com/v2/verify'

    const plan = planExternalAuthSync(baseline, local, remote)
    expect(plan.conflicts).toEqual([])
    expect(plan.updateRequired).toBe(false)
  })

  it('requires a draft for local edits and treats redacted secrets as opaque', () => {
    const baseline = manifest()
    baseline.fields[0].defaultValue = '${remote}'
    const local = structuredClone(baseline)
    const remote = structuredClone(baseline)
    local.fields[0].label = 'Changed'

    const locked = planExternalAuthSync(baseline, local, remote, { status: 'live' })
    expect(locked.errors).toContain('External authentication can only be changed on a draft app version.')

    const unchanged = planExternalAuthSync(baseline, baseline, remote)
    expect(unchanged.localChanges).toEqual([])
    expect(unchanged.updateRequired).toBe(false)
  })
})
