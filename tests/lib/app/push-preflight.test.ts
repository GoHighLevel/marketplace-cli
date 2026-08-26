import { describe, expect, it, vi } from 'vitest'

import { validateDynamicAuthConfiguration } from '../../../src/lib/app/push-preflight.js'
import { createAppSyncPlan } from '../../../src/lib/app/sync.js'
import { WorkspaceState } from '../../../src/lib/app/workspace.js'
import { cloneAppFiles, completeAppFiles } from '../../helpers/app-files.js'

function planWith(change: (files: ReturnType<typeof completeAppFiles>) => void) {
  const baseline = completeAppFiles()
  const local = cloneAppFiles(baseline)
  change(local)
  const state: WorkspaceState = {
    schemaVersion: 1,
    appId: baseline.app.appId,
    versionId: baseline.app.versionId,
    baseline: cloneAppFiles(baseline)
  }
  return createAppSyncPlan(local, state, cloneAppFiles(baseline))
}

function catalogClient() {
  return {
    getScopesCatalog: vi.fn().mockResolvedValue([
      { scope: 'contacts.readonly', tokenType: ['Location'] },
      { scope: 'contacts.write', tokenType: ['Location'] }
    ]),
    getWebhooksCatalog: vi.fn().mockResolvedValue({
      events: ['ContactCreate', 'ContactUpdate'],
      mapping: {
        'contacts.readonly': ['ContactCreate', 'ContactUpdate'],
        'contacts.write': ['ContactCreate', 'ContactUpdate']
      }
    })
  }
}

describe('validateDynamicAuthConfiguration', () => {
  it('does not read catalogs for URL-only auth changes', async () => {
    const plan = planWith(files => {
      files.webhooks.webhookUrl = 'https://hooks.acme.example.com/v2'
    })
    const client = catalogClient()

    await expect(validateDynamicAuthConfiguration(client, plan)).resolves.toEqual([])
    expect(client.getScopesCatalog).not.toHaveBeenCalled()
    expect(client.getWebhooksCatalog).not.toHaveBeenCalled()
  })

  it('reads only the webhook catalog for subscription changes', async () => {
    const plan = planWith(files => {
      files.webhooks.subscribedEvents = [{ name: 'ContactUpdate' }]
    })
    const client = catalogClient()

    await expect(validateDynamicAuthConfiguration(client, plan)).resolves.toEqual([])
    expect(client.getScopesCatalog).not.toHaveBeenCalled()
    expect(client.getWebhooksCatalog).toHaveBeenCalledOnce()
  })

  it('reuses a supplied webhook catalog for subscription changes', async () => {
    const plan = planWith(files => {
      files.webhooks.subscribedEvents = [{ name: 'ContactUpdate' }]
    })
    const client = catalogClient()
    const webhooks = await client.getWebhooksCatalog()
    client.getWebhooksCatalog.mockClear()

    await expect(validateDynamicAuthConfiguration(client, plan, { webhooks })).resolves.toEqual([])
    expect(client.getScopesCatalog).not.toHaveBeenCalled()
    expect(client.getWebhooksCatalog).not.toHaveBeenCalled()
  })

  it('validates changed scopes and their event compatibility before mutation', async () => {
    const plan = planWith(files => {
      files.app.oauth.allowedScopes = ['unknown.scope']
    })
    const client = catalogClient()

    const errors = await validateDynamicAuthConfiguration(client, plan)

    expect(errors).toEqual([
      expect.stringMatching(/unknown\.scope/),
      expect.stringMatching(/ContactCreate.*ContactUpdate/)
    ])
    expect(client.getScopesCatalog).toHaveBeenCalledOnce()
    expect(client.getWebhooksCatalog).toHaveBeenCalledOnce()
  })
})
