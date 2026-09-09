import { describe, expect, it } from 'vitest'

import {
  buildWorkflowActionsManifest,
  createWorkflowActionScaffold,
  toWorkflowActionUpdateBody
} from '../../../../src/lib/workflows/actions/manifest.js'

describe('workflow action manifests', () => {
  it('groups every remote action version and excludes server-owned fields', () => {
    const manifest = buildWorkflowActionsManifest('app-1', [
      {
        _id: 'mongo-draft',
        templateId: 'action-1',
        appId: 'app-1',
        key: 'send_message',
        version: '1.1',
        status: 'draft',
        info: { name: 'Send message', description: 'Sends a message' },
        inputs: [{
          field: 'message',
          title: 'Message',
          fieldType: 'textarea',
          required: true,
          order: 2,
          hasDynamicOptions: false,
          showHelpTextAsInfoToolTip: true,
          disableDatesFunction: '(params) => false'
        }],
        sectionOrder: ['message'],
        groupConfigs: { delivery: { dividerPosition: 'above' } },
        executionConfig: {
          type: 'API',
          method: 'POST',
          url: 'https://example.com/actions/send',
          headers: {
            Authorization: 'Bearer private',
            'Content-Type': 'application/json',
            'X-Credential': 'private-value'
          }
        },
        createdBy: 'developer-1',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        _id: 'mongo-live',
        templateId: 'action-1',
        appId: 'app-1',
        key: 'send_message',
        version: '1.0',
        status: 'published',
        info: { name: 'Send message' }
      }
    ])

    expect(manifest).toEqual({
      schemaVersion: 1,
      appId: 'app-1',
      actions: [
        {
          templateId: 'action-1',
          key: 'send_message',
          versions: [
            {
              version: '1.1',
              status: 'draft',
              info: { name: 'Send message', description: 'Sends a message' },
              inputs: [{
                field: 'message',
                title: 'Message',
                fieldType: 'textarea',
                required: true,
                order: 2,
                hasDynamicOptions: false,
                showHelpTextAsInfoToolTip: true,
                disableDatesFunction: '(params) => false'
              }],
              sectionOrder: ['message'],
              groupConfigs: { delivery: { dividerPosition: 'above' } },
              executionConfig: {
                type: 'API',
                method: 'POST',
                url: 'https://example.com/actions/send',
                headers: {
                  Authorization: '${remote}',
                  'Content-Type': 'application/json',
                  'X-Credential': '${remote}'
                }
              }
            },
            { version: '1.0', status: 'published', info: { name: 'Send message' } }
          ]
        }
      ]
    })
  })

  it('creates a UI-oriented local draft without pretending that a server template id exists', () => {
    expect(createWorkflowActionScaffold('Send message', 'send_message')).toEqual({
      key: 'send_message',
      versions: [{
        version: '1.0',
        status: 'draft',
        info: { name: 'Send message' },
        inputs: [],
        customVars: [],
        customVarsJson: {},
        payloadCustomizationType: 'default',
        customizedPayload: {},
        branchesConfig: {}
      }]
    })
  })

  it('normalizes legacy API execution defaults used by the backend and UI', () => {
    const manifest = buildWorkflowActionsManifest('app-1', [
      {
        templateId: 'action-1',
        appId: 'app-1',
        key: 'legacy_action',
        version: '1.0',
        status: 'draft',
        info: { name: 'Legacy action' },
        executionConfig: { url: 'https://example.com/action' }
      }
    ])

    expect(manifest.actions[0].versions[0].executionConfig).toEqual({
      type: 'API',
      method: 'POST',
      url: 'https://example.com/action'
    })
  })

  it('removes stale execution fields and empty header arrays returned by legacy API records', () => {
    const manifest = buildWorkflowActionsManifest('app-1', [
      {
        templateId: 'action-1',
        appId: 'app-1',
        key: 'legacy_action',
        version: '2.0',
        status: 'draft',
        info: { name: 'Legacy code action' },
        executionConfig: {
          type: 'CODE',
          url: 'https://example.com/legacy',
          method: 'POST',
          headers: { Accept: 'application/json' },
          code: 'return {}',
          pauseExecution: false
        },
        payloadCustomizationType: 'custom',
        customizedPayload: { legacy: true }
      },
      {
        templateId: 'action-1',
        appId: 'app-1',
        key: 'legacy_action',
        version: '1.0',
        status: 'published',
        info: { name: 'Legacy API action' },
        executionConfig: {
          type: 'API',
          url: 'https://example.com/action',
          method: 'POST',
          headers: [],
          code: 'return {}'
        }
      }
    ])

    expect(manifest.actions[0].versions[0]).toEqual({
      version: '2.0',
      status: 'draft',
      info: { name: 'Legacy code action' },
      executionConfig: { type: 'CODE', code: 'return {}', pauseExecution: false }
    })
    expect(manifest.actions[0].versions[1].executionConfig).toEqual({
      type: 'API',
      url: 'https://example.com/action',
      method: 'POST'
    })
  })

  it('hydrates preserved and environment-backed headers only when creating the API body', () => {
    const body = toWorkflowActionUpdateBody(
      {
        version: '1.1',
        status: 'draft',
        info: { name: 'Send message' },
        executionConfig: {
          type: 'API',
          method: 'POST',
          url: 'https://example.com/actions/send',
          headers: { Authorization: '${remote}', 'X-Api-Key': '${env:ACTION_API_KEY}' }
        }
      },
      {
        version: '1.1',
        status: 'draft',
        info: { name: 'Send message' },
        executionConfig: {
          type: 'API',
          method: 'POST',
          url: 'https://example.com/actions/send',
          headers: { Authorization: 'Bearer current', 'X-Api-Key': 'old' }
        }
      },
      { ACTION_API_KEY: 'new-key' }
    )

    expect(body.executionConfig?.headers).toEqual({
      Authorization: 'Bearer current',
      'X-Api-Key': 'new-key'
    })
    expect(body.status).toBe('draft')
    expect(body).not.toHaveProperty('version')
  })

  it('omits API-only payload fields from CODE update bodies', () => {
    const body = toWorkflowActionUpdateBody({
      version: '1.0',
      status: 'draft',
      info: { name: 'Run code' },
      executionConfig: { type: 'CODE', code: 'return {}' },
      payloadCustomizationType: 'default',
      customizedPayload: {}
    })

    expect(body.executionConfig).toEqual({ type: 'CODE', code: 'return {}' })
    expect(body).not.toHaveProperty('payloadCustomizationType')
    expect(body).not.toHaveProperty('customizedPayload')
  })

  it('redacts and restores nested request headers without relying on array order', () => {
    const remote = {
      templateId: 'action-1',
      appId: 'app-1',
      key: 'send_message',
      version: '1.0',
      status: 'draft',
      info: { name: 'Send message' },
      customVars: [{
        name: 'Result',
        reference: 'result',
        fieldType: 'string',
        fetchOptions: {
          url: 'https://example.com/results',
          headers: { Authorization: 'Bearer result' }
        }
      }],
      customVarsJson: {
        headers: { 'X-Response-Source': 'workflow-action' },
        result: 'delivered'
      },
      customizedPayload: {
        headers: { 'X-Payload-Label': 'contact-sync' }
      },
      branchesConfig: {
        predefinedBranches: {
          fetchBranches: {
            url: 'https://example.com/branches',
            headers: { 'X-Api-Key': 'branch-secret' }
          }
        }
      },
      inputs: [
        {
          field: 'first',
          title: 'First',
          fieldType: 'select',
          dynamicSource: {
            executionType: 'API',
            url: 'https://example.com/first',
            headers: { Authorization: 'Bearer first' }
          }
        },
        {
          field: 'second',
          title: 'Second',
          fieldType: 'select',
          dynamicSource: {
            executionType: 'API',
            url: 'https://example.com/second',
            headers: { Authorization: 'Bearer second' },
            pagination: {
              searchDetail: {
                executionType: 'API',
                url: 'https://example.com/search',
                headers: { 'X-Api-Key': 'search-secret' }
              }
            }
          }
        }
      ]
    }
    const localVersion = buildWorkflowActionsManifest('app-1', [remote]).actions[0].versions[0]
    const runtimeVersion = buildWorkflowActionsManifest('app-1', [remote], { redactSecrets: false }).actions[0].versions[0]
    localVersion.inputs?.reverse()

    expect(localVersion.inputs?.[0].dynamicSource).toMatchObject({
      headers: { Authorization: '${remote}' },
      pagination: { searchDetail: { headers: { 'X-Api-Key': '${remote}' } } }
    })
    expect(localVersion.customVars?.[0].fetchOptions).toMatchObject({
      headers: { Authorization: '${remote}' }
    })
    expect(localVersion.branchesConfig?.predefinedBranches?.fetchBranches).toMatchObject({
      headers: { 'X-Api-Key': '${remote}' }
    })
    expect(localVersion.customVarsJson).toMatchObject({
      headers: { 'X-Response-Source': 'workflow-action' }
    })
    expect(localVersion.customizedPayload).toMatchObject({
      headers: { 'X-Payload-Label': 'contact-sync' }
    })

    const body = toWorkflowActionUpdateBody(localVersion, runtimeVersion)
    expect(body.inputs?.[0].dynamicSource).toMatchObject({
      headers: { Authorization: 'Bearer second' },
      pagination: { searchDetail: { headers: { 'X-Api-Key': 'search-secret' } } }
    })
    expect(body.inputs?.[1].dynamicSource).toMatchObject({
      headers: { Authorization: 'Bearer first' }
    })
    expect(body.customVars?.[0].fetchOptions).toMatchObject({
      headers: { Authorization: 'Bearer result' }
    })
    expect(body.branchesConfig?.predefinedBranches?.fetchBranches).toMatchObject({
      headers: { 'X-Api-Key': 'branch-secret' }
    })
    expect(body.customVarsJson).toMatchObject({
      headers: { 'X-Response-Source': 'workflow-action' }
    })
    expect(body.customizedPayload).toMatchObject({
      headers: { 'X-Payload-Label': 'contact-sync' }
    })
  })
})
