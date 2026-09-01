import { describe, expect, it } from 'vitest'

import {
  workflowActionPrerequisiteErrors,
  WORKFLOW_ACTION_REQUIRED_SCOPE
} from '../../../../src/lib/workflows/actions/contract.js'

describe('workflow action app prerequisites', () => {
  it('requires the discovery scope only when the app contains workflow actions', () => {
    expect(workflowActionPrerequisiteErrors([], 0)).toEqual([])
    expect(workflowActionPrerequisiteErrors([WORKFLOW_ACTION_REQUIRED_SCOPE], 1)).toEqual([])
    expect(workflowActionPrerequisiteErrors(['contacts.readonly'], 1)).toEqual([
      'ghl-app.json.oauth.allowedScopes must include "workflows.readonly" before workflow actions can be pushed or published.'
    ])
  })
})
