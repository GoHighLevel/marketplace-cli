import { describe, expect, it } from 'vitest'

import { WorkflowTriggersManifest } from '../../../../src/lib/workflows/triggers/manifest.js'
import {
  validateWorkflowTriggersManifest,
  validateWorkflowTriggerVersionForPublish
} from '../../../../src/lib/workflows/triggers/schema.js'

function validManifest(): WorkflowTriggersManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    triggers: [{
      key: 'contact_changed',
      versions: [{
        version: '1.0',
        status: 'draft',
        info: {
          name: 'Contact changed',
          description: 'Starts a workflow when a contact changes.',
          summary: 'Use this trigger to process contact changes from the integration.',
          icon: 'fa-address-card'
        },
        customVarsJson: {
          contact: { id: 'contact-1', email: 'person@example.com' },
          tags: ['customer']
        },
        filters: [
          {
            field: 'contact.email',
            title: 'Email',
            required: true,
            fieldType: 'string',
            altersDynamicField: false
          },
          {
            field: 'tags',
            title: 'Tags',
            required: false,
            fieldType: 'multiselect',
            mappedTo: 'TAGS',
            altersDynamicField: true
          },
          {
            field: 'DYNAMIC',
            title: 'Additional filters',
            required: false,
            fieldType: 'DYNAMIC',
            dynamicFieldsConfig: {
              url: 'https://api.example.com/workflow/filters',
              headers: { Authorization: '${env:FILTER_TOKEN}' }
            }
          }
        ],
        customVars: [
          { name: 'Contact ID', reference: 'contact.id', fieldType: 'string' },
          { name: 'Tags', reference: 'tags', fieldType: 'array' }
        ],
        subscriptionConfig: {
          url: 'https://api.example.com/workflow/subscriptions',
          headers: { Authorization: '${env:SUBSCRIPTION_TOKEN}' }
        }
      }]
    }]
  }
}

describe('workflow trigger schema validation', () => {
  it('accepts the complete public UI trigger contract', () => {
    expect(validateWorkflowTriggersManifest(validManifest())).toEqual([])
    expect(validateWorkflowTriggerVersionForPublish(validManifest(), 'contact_changed', '1.0')).toEqual([])
  })

  it('enforces conditional filter sources and a single dynamic filter', () => {
    const manifest = validManifest()
    const version = manifest.triggers[0].versions[0]
    version.filters = [
      {
        field: 'contact.email',
        title: 'Email',
        fieldType: 'select',
        options: [{ label: 'One', value: 'one' }],
        mappedTo: 'TAGS'
      },
      {
        field: 'DYNAMIC',
        title: 'Dynamic one',
        required: true,
        fieldType: 'DYNAMIC'
      },
      {
        field: 'DYNAMIC',
        title: 'Dynamic two',
        fieldType: 'DYNAMIC',
        dynamicFieldsConfig: { url: 'https://127.0.0.1/private' }
      }
    ]

    const errors = validateWorkflowTriggersManifest(manifest)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('must define exactly one option source'),
      expect.stringContaining('required must be false for a dynamic filter'),
      expect.stringContaining('dynamicFieldsConfig is required for a dynamic filter'),
      expect.stringContaining('may contain at most one DYNAMIC filter'),
      expect.stringContaining('must use a public internet host')
    ]))
  })

  it('validates payload references, custom-variable types, and duplicate fields', () => {
    const manifest = validManifest()
    const version = manifest.triggers[0].versions[0]
    version.filters = [
      { field: 'missing', title: 'Missing', fieldType: 'string' },
      { field: 'missing', title: 'Duplicate', fieldType: 'string' }
    ]
    version.customVars = [
      { name: 'Email', reference: 'contact.email', fieldType: 'boolean' },
      { name: 'Missing', reference: 'contact.missing', fieldType: 'string' }
    ]

    expect(validateWorkflowTriggersManifest(manifest)).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicates filter field "missing"'),
      expect.stringContaining('does not resolve in customVarsJson'),
      expect.stringContaining('fieldType must be "string" for trigger-data reference "contact.email"')
    ]))
  })

  it('rejects unsupported properties, unsafe headers, and incomplete publish configuration', () => {
    const manifest = validManifest() as unknown as Record<string, unknown>
    const trigger = (manifest.triggers as Array<Record<string, unknown>>)[0]
    const version = (trigger.versions as Array<Record<string, unknown>>)[0]
    version.unexpected = true
    version.subscriptionConfig = {
      headers: { 'Bad Header': 'literal-secret', Authorization: 'literal-secret' }
    }

    const errors = validateWorkflowTriggersManifest(manifest)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('unexpected is not a supported property'),
      expect.stringMatching(/Bad Header.*must be a valid HTTP header name/),
      expect.stringContaining('Authorization is sensitive and must use an environment or remote-preservation reference'),
      expect.stringContaining('url is required when subscription headers are configured')
    ]))
    expect(validateWorkflowTriggerVersionForPublish(manifest as unknown as WorkflowTriggersManifest, 'contact_changed', '1.0')).toEqual(
      expect.arrayContaining([expect.stringContaining('subscriptionConfig.url is required before submission for review')])
    )
  })

  it('enforces immutable manifest structure, version ownership, and the UI limit', () => {
    const manifest = validManifest()
    manifest.triggers = Array.from({ length: 21 }, (_, index) => ({
      key: `trigger_${index}`,
      versions: [{ version: '1.0', status: 'draft', info: { name: `Trigger ${index}` } }]
    }))
    manifest.triggers[0].versions.push({ version: '1.1', status: 'draft', info: { name: 'Second draft' } })

    expect(validateWorkflowTriggersManifest(manifest)).toEqual(expect.arrayContaining([
      expect.stringContaining('supports at most 20 triggers per app'),
      expect.stringContaining('may contain only one draft version')
    ]))
  })
})
