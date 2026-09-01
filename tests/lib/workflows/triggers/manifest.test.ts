import { describe, expect, it } from 'vitest'

import {
  buildWorkflowTriggersManifest,
  createEmptyWorkflowTriggersManifest,
  createWorkflowTriggerScaffold,
  toWorkflowTriggerUpdateBody
} from '../../../../src/lib/workflows/triggers/manifest.js'

describe('workflow trigger manifest mapping', () => {
  it('groups versions, normalizes UI sample data, and redacts nested header credentials', () => {
    const manifest = buildWorkflowTriggersManifest('app-1', [
      {
        appId: 'app-1',
        templateId: 'trigger-1',
        key: 'contact_changed',
        version: '1.0',
        status: 'published',
        info: { name: 'Contact changed' },
        sampleResponseJson: { contact: { id: 'abc' } },
        subscriptionConfig: {
          url: 'https://example.com/subscriptions',
          headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }
        },
        filters: [{
          field: 'contact.id',
          title: 'Contact ID',
          fieldType: 'select',
          options: [{ label: 'Example', value: 'abc' }],
          fetchOptions: undefined
        }]
      },
      {
        appId: 'app-1',
        templateId: 'trigger-1',
        key: 'contact_changed',
        version: '1.1',
        status: 'draft',
        info: { name: 'Contact changed v2' },
        customVarsJson: { contact: { id: 'def' } }
      }
    ])

    expect(manifest.triggers).toHaveLength(1)
    expect(manifest.triggers[0].versions.map(version => version.version)).toEqual(['1.1', '1.0'])
    expect(manifest.triggers[0].versions[0].customVarsJson).toEqual({ contact: { id: 'def' } })
    expect(manifest.triggers[0].versions[1].customVarsJson).toEqual({ contact: { id: 'abc' } })
    expect(manifest.triggers[0].versions[1].subscriptionConfig?.headers).toEqual({
      Authorization: '${remote}',
      'Content-Type': 'application/json'
    })
  })

  it('creates deterministic empty and draft manifests', () => {
    expect(createEmptyWorkflowTriggersManifest('app-1')).toEqual({ schemaVersion: 1, appId: 'app-1', triggers: [] })
    expect(createWorkflowTriggerScaffold('Contact changed', 'contact_changed')).toEqual({
      key: 'contact_changed',
      versions: [{
        version: '1.0',
        status: 'draft',
        info: { name: 'Contact changed' },
        filters: [],
        customVars: [],
        customVarsJson: {}
      }]
    })
  })

  it('hydrates environment and remote header references without exposing them locally', () => {
    const desired = {
      version: '1.0',
      status: 'draft' as const,
      info: { name: 'Contact changed' },
      subscriptionConfig: {
        url: 'https://example.com/subscriptions',
        headers: { Authorization: '${env:TRIGGER_TOKEN}', 'X-Account': '${remote}' }
      }
    }
    const current = {
      ...desired,
      subscriptionConfig: {
        ...desired.subscriptionConfig,
        headers: { Authorization: 'old-token', 'X-Account': 'account-1' }
      }
    }

    expect(toWorkflowTriggerUpdateBody(desired, current, { TRIGGER_TOKEN: 'new-token' })).toMatchObject({
      status: 'draft',
      subscriptionConfig: {
        headers: { Authorization: 'new-token', 'X-Account': 'account-1' }
      }
    })
  })
})
