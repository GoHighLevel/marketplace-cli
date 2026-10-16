import { describe, expect, it } from 'vitest'

import { createWorkflowItemVersion, publishBlockedError } from '../../../../src/lib/workflows/shared/release.js'
import { WORKFLOW_ACTIONS_RESOURCE } from '../../../../src/lib/workflows/actions/resource.js'

describe('createWorkflowItemVersion', () => {
  it('reports an unknown key as not found before calling the portal', async () => {
    const context = { remote: { schemaVersion: 1, appId: 'app-1', actions: [] } } as unknown as Parameters<
      typeof createWorkflowItemVersion
    >[1]
    await expect(createWorkflowItemVersion(WORKFLOW_ACTIONS_RESOURCE, context, 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workflow action "missing" was not found.'
    })
  })
})

describe('publishBlockedError', () => {
  it("names the developer's file instead of the portal manifest path, and how to proceed", () => {
    const error = publishBlockedError('Workflow trigger', 'e2e-contact-flagged.json', [
      'workflow-triggers.json.triggers[2].versions[0].subscriptionConfig.url is required before submission for review.',
      'Another problem.'
    ])

    expect(error.code).toBe('INVALID_STATE')
    expect(error.message).toBe(
      [
        'Workflow trigger cannot be published:',
        '- e2e-contact-flagged.json.versions[0].subscriptionConfig.url is required before submission for review.',
        '- Another problem.',
        'Fix e2e-contact-flagged.json, push it, then publish.'
      ].join('\n')
    )
  })
})
