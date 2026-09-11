import { describe, expect, it } from 'vitest'

import {
  workflowTriggerPrerequisiteErrors,
  WORKFLOW_TRIGGER_REQUIRED_SCOPE
} from '../../../../src/lib/workflows/triggers/contract.js'

describe('workflow trigger app prerequisites', () => {
  const valid = {
    allowedScopes: [WORKFLOW_TRIGGER_REQUIRED_SCOPE],
    redirectUris: ['https://example.com/oauth/callback'],
    clientKeyCount: 1,
    userTypes: ['Location']
  }

  it('requires a location OAuth app only when triggers exist', () => {
    expect(workflowTriggerPrerequisiteErrors({ ...valid, triggerCount: 0 })).toEqual([])
    expect(workflowTriggerPrerequisiteErrors({ ...valid, triggerCount: 1 })).toEqual([])
    expect(
      workflowTriggerPrerequisiteErrors({
        triggerCount: 1,
        allowedScopes: [],
        redirectUris: [],
        clientKeyCount: 0,
        userTypes: ['Agency']
      })
    ).toEqual([
      'ghl-app.json.oauth.allowedScopes must include "workflows.readonly" before workflow triggers can be pushed or published.',
      'ghl-app.json.oauth.redirectUris must contain at least one OAuth redirect URI before workflow triggers can be pushed or published.',
      'ghl-app.json.oauth.clientKeys must contain at least one client key before workflow triggers can be pushed or published.',
      'ghl-app.json.listing.userTypes must include "Location" before workflow triggers can be pushed or published.'
    ])
  })
})
