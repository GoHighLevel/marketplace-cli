import { describe, expect, it } from 'vitest'

import { type WorkspaceState } from '../../../src/lib/app/workspace.js'
import { createAppSyncPlan, validateLocalAppWorkspace, validateSyncPlan } from '../../../src/lib/app/sync.js'
import { cloneAppFiles, completeAppFiles, completeAppVersion } from '../../helpers/app-files.js'

function stateFor(files = completeAppFiles()): WorkspaceState {
  return {
    schemaVersion: 1,
    appId: files.app.appId,
    versionId: files.app.versionId,
    baseline: cloneAppFiles(files)
  }
}

describe('createAppSyncPlan', () => {
  it('maps only locally changed fields to their owning API sections', () => {
    const baseline = completeAppFiles()
    const local = cloneAppFiles(baseline)
    local.app.basicInfo.name = 'Acme CRM Plus'
    local.webhooks.subscribedEvents.find(event => event.name === 'ContactUpdate')!.url =
      'https://api.acme.example.com/contact-update-v2'

    const plan = createAppSyncPlan(local, stateFor(baseline), cloneAppFiles(baseline))

    expect(plan.sections).toEqual(['basicInfo', 'authSettings'])
    expect(plan.localChanges.map(change => change.path)).toEqual([
      'basicInfo.name',
      'webhooks.subscribedEvents.ContactUpdate'
    ])
    expect(plan.remoteChanges).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('ignores ordering differences for set-like fields and webhook subscriptions', () => {
    const baseline = completeAppFiles({
      allowedScopes: ['contacts.readonly', 'contacts.write'],
      searchKeywords: ['crm', 'contacts']
    })
    const local = cloneAppFiles(baseline)
    local.app.oauth.allowedScopes.reverse()
    local.app.listing.searchKeywords.reverse()
    local.webhooks.subscribedEvents.reverse()

    const plan = createAppSyncPlan(local, stateFor(baseline), cloneAppFiles(baseline))

    expect(plan.localChanges).toEqual([])
    expect(plan.sections).toEqual([])
  })

  it('preserves non-overlapping UI changes while planning local changes', () => {
    const baseline = completeAppFiles()
    const local = cloneAppFiles(baseline)
    const remote = cloneAppFiles(baseline)
    local.app.basicInfo.tagline = 'Keep every customer relationship organized'
    remote.app.supportConfig.documentationUrl = 'https://new-docs.acme.example.com'

    const plan = createAppSyncPlan(local, stateFor(baseline), remote)

    expect(plan.sections).toEqual(['basicInfo'])
    expect(plan.remoteChanges.map(change => change.path)).toEqual(['supportConfig.documentationUrl'])
    expect(plan.desired.app.supportConfig.documentationUrl).toBe('https://new-docs.acme.example.com')
    expect(plan.desired.app.basicInfo.tagline).toBe('Keep every customer relationship organized')
    expect(plan.conflicts).toEqual([])
  })

  it('merges non-overlapping additions and removals within set-like fields', () => {
    const baseline = completeAppFiles({
      allowedScopes: ['contacts.readonly', 'contacts.write'],
      searchKeywords: ['crm', 'contacts']
    })
    const local = cloneAppFiles(baseline)
    const remote = cloneAppFiles(baseline)
    local.app.oauth.allowedScopes = ['contacts.readonly', 'users.readonly']
    remote.app.oauth.allowedScopes.push('locations.readonly')
    local.app.listing.searchKeywords.push('sync')
    remote.app.listing.searchKeywords = ['contacts', 'automation']

    const plan = createAppSyncPlan(local, stateFor(baseline), remote)

    expect(plan.conflicts).toEqual([])
    expect(plan.desired.app.oauth.allowedScopes).toEqual(['contacts.readonly', 'locations.readonly', 'users.readonly'])
    expect(plan.desired.app.listing.searchKeywords).toEqual(['automation', 'contacts', 'sync'])
    expect(plan.sections).toEqual(['listing', 'authSettings'])
    expect(plan.remoteChanges.map(change => change.path)).toEqual(['listing.searchKeywords', 'oauth.allowedScopes'])
  })

  it('reports server-owned UI changes without scheduling a mutation API', () => {
    const baseline = completeAppFiles()
    const remote = cloneAppFiles(baseline)
    remote.app.status = 'review'
    remote.app.oauth.clientKeys.push({ id: 'client-2', name: 'New key', isDefault: false })

    const plan = createAppSyncPlan(cloneAppFiles(baseline), stateFor(baseline), remote)

    expect(plan.remoteChanges.map(change => change.path)).toEqual(['status', 'oauth.clientKeys'])
    expect(plan.remoteChanges.every(change => change.section === 'readOnly')).toBe(true)
    expect(plan.sections).toEqual([])
  })

  it('detects same-field conflicts but treats equal local and UI results as resolved', () => {
    const baseline = completeAppFiles()
    const local = cloneAppFiles(baseline)
    const remote = cloneAppFiles(baseline)
    local.app.basicInfo.name = 'Local name'
    remote.app.basicInfo.name = 'UI name'

    const conflict = createAppSyncPlan(local, stateFor(baseline), remote)
    expect(conflict.conflicts.map(change => change.path)).toEqual(['basicInfo.name'])
    expect(conflict.sections).toEqual([])

    remote.app.basicInfo.name = 'Local name'
    const resolved = createAppSyncPlan(local, stateFor(baseline), remote)
    expect(resolved.conflicts).toEqual([])
    expect(resolved.sections).toEqual([])
  })

  it('diffs webhook additions and removals by event name rather than array position', () => {
    const baseline = completeAppFiles()
    const local = cloneAppFiles(baseline)
    local.webhooks.subscribedEvents = [
      { name: 'ContactUpdate', url: 'https://api.acme.example.com/contact-update' },
      { name: 'ContactDelete' }
    ]

    const plan = createAppSyncPlan(local, stateFor(baseline), cloneAppFiles(baseline))

    expect(plan.localChanges.map(change => change.path)).toEqual([
      'webhooks.subscribedEvents.ContactCreate',
      'webhooks.subscribedEvents.ContactDelete'
    ])
    expect(plan.desired.webhooks.subscribedEvents).toEqual([
      { name: 'ContactDelete' },
      { name: 'ContactUpdate', url: 'https://api.acme.example.com/contact-update' }
    ])
    expect(plan.sections).toEqual(['authSettings'])
  })
})

describe('local app validation', () => {
  it('rejects unsupported and removed configuration properties', () => {
    const files = completeAppFiles()
    Object.defineProperty(files.app, '__proto__', { value: { polluted: true }, enumerable: true })
    Object.assign(files.app as unknown as Record<string, unknown>, {
      externalConfig: {},
      mcpConfig: {},
      customPages: []
    })
    Object.assign(files.app.oauth as unknown as Record<string, unknown>, {
      hasExternalAuth: true,
      externalAuthConfig: {}
    })

    const validation = validateLocalAppWorkspace(files, stateFor())

    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/workspace\.app\.__proto__.*not a supported property/i),
        expect.stringMatching(/workspace\.app\.externalConfig.*not a supported property/i),
        expect.stringMatching(/workspace\.app\.mcpConfig.*not a supported property/i),
        expect.stringMatching(/workspace\.app\.customPages.*not a supported property/i),
        expect.stringMatching(/workspace\.app\.oauth\.hasExternalAuth.*not a supported property/i),
        expect.stringMatching(/workspace\.app\.oauth\.externalAuthConfig.*not a supported property/i)
      ])
    )
  })

  it('validates changed sections without requiring unrelated draft sections to be publish-ready', () => {
    const baseline = completeAppFiles({ description: '', previewImageUrls: [] })
    const local = cloneAppFiles(baseline)
    local.webhooks.subscribedEvents.find(event => event.name === 'ContactUpdate')!.url =
      'https://api.acme.example.com/contact-update-v2'

    const validation = validateLocalAppWorkspace(local, stateFor(baseline))

    expect(validation.errors).toEqual([])
    expect(validation.sections).toEqual(['authSettings'])
  })

  it('rejects invalid changed values and read-only edits', () => {
    const baseline = completeAppFiles()
    const local = cloneAppFiles(baseline)
    local.webhooks.subscribedEvents.find(event => event.name === 'ContactUpdate')!.url = 'http://localhost/hook'
    local.app.status = 'live'

    const validation = validateLocalAppWorkspace(local, stateFor(baseline))

    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/ContactUpdate.*https/i),
        expect.stringMatching(/status.*read-only/i)
      ])
    )
  })

  it('rejects inconsistent identities and malformed duplicate collections', () => {
    const files = completeAppFiles()
    files.webhooks.appId = 'other-app'
    files.app.oauth.redirectUris.push(files.app.oauth.redirectUris[0])

    const validation = validateLocalAppWorkspace(files, stateFor())

    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/webhook.*appId.*app manifest/i),
        expect.stringMatching(/duplicate redirect/i)
      ])
    )
  })

  it('rejects unsafe workspace identifiers before identity decisions', () => {
    const files = completeAppFiles()
    files.app.appId = 'app-1\nother'
    files.webhooks.appId = files.app.appId
    files.app.versionId = '../version-1'
    files.webhooks.versionId = files.app.versionId

    const validation = validateLocalAppWorkspace(files, stateFor(files))

    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/workspace\.app\.appId must contain only letters, numbers, underscores, or hyphens/i),
        expect.stringMatching(/workspace\.app\.versionId must contain only letters, numbers, underscores, or hyphens/i)
      ])
    )
    expect(validation.sections).toEqual([])
  })

  it('rejects derived billing edits and missing conditional billing values', () => {
    const baseline = completeAppFiles()
    const local = cloneAppFiles(baseline)
    local.app.billing.isPaidApp = true
    local.app.billing.externalBilling = true

    const validation = validateLocalAppWorkspace(local, stateFor(baseline))

    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/billing\.isPaidApp.*derived.*read-only/i),
        expect.stringMatching(/externalBillingUrl.*required/i)
      ])
    )
  })

  it('rejects default redirect changes on draft versions like the portal', () => {
    const baseline = completeAppFiles({
      redirectUris: ['https://acme.example.com/oauth/callback', 'https://acme.example.com/oauth/secondary']
    })
    const local = cloneAppFiles(baseline)
    local.app.oauth.defaults.redirectUrl = 'https://acme.example.com/oauth/secondary'

    const validation = validateLocalAppWorkspace(local, stateFor(baseline))

    expect(validation.errors).toEqual([expect.stringMatching(/must be live, deprecating or deprecated/i)])
  })

  it('requires a draft before changing live OAuth scopes or redirect URIs', () => {
    const baseline = completeAppFiles({ status: 'live' })
    const local = cloneAppFiles(baseline)
    local.app.oauth.allowedScopes.push('contacts.write')

    const validation = validateLocalAppWorkspace(local, stateFor(baseline))

    expect(validation.errors).toEqual([expect.stringMatching(/live version.*ghl app draft/i)])
  })

  it('validates the final merged payload after non-overlapping UI changes', () => {
    const baseline = completeAppFiles()
    const local = cloneAppFiles(baseline)
    const remote = cloneAppFiles(baseline)
    local.app.basicInfo.name = 'Local name'
    remote.app.basicInfo.tagline = 'short'
    const plan = createAppSyncPlan(local, stateFor(baseline), remote)

    const validation = validateSyncPlan(plan, completeAppVersion({ tagline: 'short' }))

    expect(validation.errors).toEqual([expect.stringMatching(/tagline.*20/i)])
  })
})
