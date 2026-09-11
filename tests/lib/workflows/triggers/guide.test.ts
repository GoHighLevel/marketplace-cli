import { describe, expect, it } from 'vitest'

import { buildWorkflowTriggersGuide } from '../../../../src/lib/workflows/triggers/guide.js'

describe('workflow trigger guide', () => {
  it('documents every supported key, filter source, callback event, and CLI command', () => {
    const guide = buildWorkflowTriggersGuide()
    for (const value of [
      'schemaVersion',
      'templateId',
      'versions',
      'customVarsJson',
      'subscriptionConfig',
      'fieldType',
      'options',
      'mappedTo',
      'fetchOptions',
      'dynamicFieldsConfig',
      'altersDynamicField',
      'CREATED',
      'UPDATED',
      'DELETED',
      'targetUrl',
      '${env:VARIABLE_NAME}',
      '${remote}',
      'triggers create',
      'triggers pull',
      'triggers validate',
      'triggers diff',
      'triggers push',
      'triggers new-version',
      'triggers publish',
      'triggers delete'
    ]) {
      expect(guide).toContain(value)
    }
    expect(guide).toMatch(/only one dynamic filter/i)
    expect(guide).toMatch(/exactly one option source/i)
    expect(guide).toMatch(/contactless workflows/i)
    expect(guide).toMatch(/three-way comparison/i)
    expect(guide).toMatch(/no synthetic `triggers test` command/i)
  })
})
