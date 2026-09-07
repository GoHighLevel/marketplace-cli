import { describe, expect, it, vi } from 'vitest'

import { WORKFLOW_ACTION_CODE_MAX_BYTES } from '../../../../src/lib/workflows/actions/code.js'
import { validateWorkflowActionsManifest } from '../../../../src/lib/workflows/actions/schema.js'

const validManifest = {
  schemaVersion: 1 as const,
  appId: 'app-1',
  actions: [
    {
      templateId: 'action-1',
      key: 'send_message',
      versions: [
        {
          version: '1.0',
          status: 'draft' as const,
          info: { name: 'Send message', description: 'Send a custom message.' },
          inputs: [
            {
              field: 'channel',
              title: 'Channel',
              fieldType: 'select',
              required: true,
              options: [
                { label: 'Email', value: 'email' },
                { label: 'SMS', value: 'sms' }
              ]
            }
          ],
          customVars: [{ name: 'Delivery ID', reference: 'delivery_id', fieldType: 'string' }],
          customVarsJson: { delivery_id: 'string' },
          executionConfig: {
            type: 'API' as const,
            method: 'POST' as const,
            url: 'https://example.com/workflow-action',
            headers: { Authorization: '${env:ACTION_TOKEN}' },
            pauseExecution: false
          },
          payloadCustomizationType: 'default' as const,
          customizedPayload: {},
          branchesConfig: {}
        }
      ]
    }
  ]
}

describe('workflow action manifest validation', () => {
  it('accepts the fields configured by the marketplace workflow-action UI', () => {
    expect(validateWorkflowActionsManifest(validManifest)).toEqual([])
  })

  it('requires response data before custom variables can be configured', () => {
    const invalid = structuredClone(validManifest) as any
    delete invalid.actions[0].versions[0].customVarsJson

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/customVarsJson.*required when customVars contains variables/)
    ]))
  })

  it('requires custom-variable references and types to match response data', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].customVarsJson = {
      result: {
        status: 'delivered',
        attempts: 2,
        tags: ['priority']
      }
    }
    invalid.actions[0].versions[0].customVars = [
      { name: 'Missing', reference: 'result.missing', fieldType: 'string' },
      { name: 'Attempts', reference: 'result.attempts', fieldType: 'string' },
      { name: 'Result', reference: 'result', fieldType: 'string' },
      { name: 'Empty tags', reference: 'emptyTags', fieldType: 'array' }
    ]
    invalid.actions[0].versions[0].customVarsJson.emptyTags = []

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/customVars\[0\]\.reference "result\.missing" does not resolve/),
      expect.stringMatching(/customVars\[1\]\.fieldType must be "numerical"/),
      expect.stringMatching(/customVars\[2\]\.reference "result" must select a primitive value or a non-empty array/),
      expect.stringMatching(/customVars\[3\]\.reference "emptyTags" must select a primitive value or a non-empty array/)
    ]))
  })

  it('accepts nested primitive and non-empty array response references', () => {
    const valid = structuredClone(validManifest) as any
    valid.actions[0].versions[0].customVarsJson = {
      result: {
        status: 'delivered',
        attempts: 2,
        billable: true,
        tags: ['priority']
      }
    }
    valid.actions[0].versions[0].customVars = [
      { name: 'Status', reference: 'result.status', fieldType: 'string' },
      { name: 'Attempts', reference: 'result.attempts', fieldType: 'numerical' },
      { name: 'Billable', reference: 'result.billable', fieldType: 'boolean' },
      { name: 'Tags', reference: 'result.tags', fieldType: 'array' }
    ]

    expect(validateWorkflowActionsManifest(valid)).toEqual([])
  })

  it('accepts date custom variables backed by JSON string samples', () => {
    const valid = structuredClone(validManifest) as any
    valid.actions[0].versions[0].customVarsJson = { completed_at: '2026-08-19T10:30:00.000Z' }
    valid.actions[0].versions[0].customVars = [
      { name: 'Completed at', reference: 'completed_at', fieldType: 'date' }
    ]

    expect(validateWorkflowActionsManifest(valid)).toEqual([])
  })

  it('rejects unknown properties, reserved keys, duplicate fields, and invalid conditional options', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].unexpected = true
    invalid.actions[0].key = 'lc_reserved'
    invalid.actions[0].versions[0].inputs.push({
      field: 'channel',
      title: 'Missing options',
      fieldType: 'radio'
    })

    expect(validateWorkflowActionsManifest(invalid)).toEqual(
      expect.arrayContaining([
        'workflow-actions.json.actions[0].unexpected is not a supported property.',
        'workflow-actions.json.actions[0].key cannot start with the reserved prefix "lc_".',
        'workflow-actions.json.actions[0].versions[0].inputs[1].field duplicates input field "channel".',
        'workflow-actions.json.actions[0].versions[0].inputs[1] must define options, mappedTo, fetchOptions, or dynamicSource for radio fields.'
      ])
    )
  })

  it('requires lowercase stable action keys because the API normalizes stored keys', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].key = 'Send_Message'

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/key must start with a lowercase letter/)
    ]))
  })

  it('rejects action keys that cannot be represented by a portable source filename', () => {
    const reserved = structuredClone(validManifest) as any
    reserved.actions[0].key = 'con'
    const oversized = structuredClone(validManifest) as any
    oversized.actions[0].key = 'a'.repeat(251)

    expect(validateWorkflowActionsManifest(reserved)).toEqual(expect.arrayContaining([
      expect.stringMatching(/key "con" is reserved by the operating system/i)
    ]))
    expect(validateWorkflowActionsManifest(oversized)).toEqual(expect.arrayContaining([
      expect.stringMatching(/key must be at most 250 characters/i)
    ]))
  })

  it('bounds workflow values before applying validation regexes', () => {
    const invalid = structuredClone(validManifest) as any
    const version = invalid.actions[0].versions[0]
    version.version = `${'1'.repeat(22)}.0`
    version.inputs[0].field = 'a'.repeat(251)
    version.customVars[0].reference = 'a'.repeat(1_001)
    version.branchesConfig = {
      fields: [{ field: 'a'.repeat(1_001), title: 'Oversized', fieldType: 'string' }]
    }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/version must be at most 21 characters/i),
      expect.stringMatching(/inputs\[0\]\.field must be at most 250 characters/i),
      expect.stringMatching(/customVars\[0\]\.reference must be at most 1,000 characters/i),
      expect.stringMatching(/branchesConfig\.fields\[0\]\.field must be at most 1,000 characters/i)
    ]))
  })

  it('validates API/code exclusivity, URLs, custom payloads, and secret references', () => {
    const invalid = structuredClone(validManifest) as any
    const version = invalid.actions[0].versions[0]
    version.executionConfig.url = 'http://localhost/callback'
    version.executionConfig.code = 'return true'
    version.executionConfig.headers.Authorization = '${env:}'
    version.payloadCustomizationType = 'custom'
    version.customizedPayload = {}

    const errors = validateWorkflowActionsManifest(invalid)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/executionConfig\.url must use a public internet host/),
      expect.stringMatching(/executionConfig\.code is only supported when type is "CODE"/),
      expect.stringMatching(/headers\.Authorization must use/),
      expect.stringMatching(/customizedPayload must not be empty/)
    ]))
  })

  it('requires an HTTP method for API execution and limits custom payloads to API actions', () => {
    const invalidApi = structuredClone(validManifest) as any
    delete invalidApi.actions[0].versions[0].executionConfig.method

    expect(validateWorkflowActionsManifest(invalidApi)).toEqual(expect.arrayContaining([
      expect.stringMatching(/executionConfig\.method is required/)
    ]))

    const invalidCode = structuredClone(validManifest) as any
    invalidCode.actions[0].versions[0].executionConfig = { type: 'CODE', code: 'return {}' }
    invalidCode.actions[0].versions[0].payloadCustomizationType = 'custom'
    invalidCode.actions[0].versions[0].customizedPayload = { message: '{{message}}' }

    expect(validateWorkflowActionsManifest(invalidCode)).toEqual(expect.arrayContaining([
      expect.stringMatching(/payloadCustomizationType can be "custom" only for API execution/)
    ]))
  })

  it('rejects stale custom payload data when default payload mode is selected', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].payloadCustomizationType = 'default'
    invalid.actions[0].versions[0].customizedPayload = { stale: true }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/customizedPayload must be empty when payloadCustomizationType is "default"/)
    ]))
  })

  it('requires references for custom headers so credentials cannot be committed accidentally', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].executionConfig.headers['X-Credential'] = 'plain-text-value'
    invalid.actions[0].versions[0].executionConfig.headers.Accept = 'application/json'

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/headers\.X-Credential.*environment or remote-preservation reference/)
    ]))
    expect(validateWorkflowActionsManifest(invalid)).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/headers\.Accept/)
    ]))
  })

  it('rejects invalid HTTP header names without emitting raw control characters', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].executionConfig.headers['Bad\nHeader'] = '${env:ACTION_TOKEN}'

    const errors = validateWorkflowActionsManifest(invalid)
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/Bad\\nHeader.*valid HTTP header name/)]))
    expect(errors.join('\n')).not.toContain('Bad\nHeader')
  })

  it('requires a complete execution and at least one input for review submission', () => {
    const draft = structuredClone(validManifest.actions[0].versions[0]) as any
    draft.inputs = []
    draft.executionConfig.url = ''

    expect(validateWorkflowActionsManifest({ ...validManifest, actions: [{ ...validManifest.actions[0], versions: [draft] }] }, { publishable: true }))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/inputs must contain at least one field/),
        expect.stringMatching(/executionConfig\.url is required/)
      ]))
  })

  it('rejects a publishability target that does not identify an existing draft', () => {
    expect(validateWorkflowActionsManifest(validManifest, {
      publishable: true,
      actionKey: 'missing_action',
      version: '1.0'
    })).toEqual(expect.arrayContaining([expect.stringMatching(/missing_action.*not found/i)]))

    expect(validateWorkflowActionsManifest(validManifest, {
      publishable: true,
      actionKey: 'send_message',
      version: '9.9'
    })).toEqual(expect.arrayContaining([expect.stringMatching(/send_message.*version 9.9.*not found/i)]))
  })

  it('enforces conditional option sources for action and branch select fields', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs[0] = {
      field: 'channel',
      title: 'Channel',
      fieldType: 'select',
      fetchOptions: {}
    }
    invalid.actions[0].versions[0].branchesConfig = {
      fields: [{ field: 'result', title: 'Result', fieldType: 'select' }]
    }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/inputs\[0\]\.fetchOptions must define exactly one source/),
      expect.stringMatching(/branchesConfig\.fields\[0\]\.options must contain at least one option/)
    ]))
  })

  it('requires one unambiguous option source and a supported internal reference', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs = [
      {
        field: 'channel',
        title: 'Channel',
        fieldType: 'select',
        options: [{ label: 'Email', value: 'email' }],
        fetchOptions: { url: 'https://example.com/options' }
      },
      {
        field: 'owner',
        title: 'Owner',
        fieldType: 'select',
        mappedTo: 'NOT_A_HIGHLEVEL_REFERENCE'
      }
    ]

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/inputs\[0\].*exactly one option source.*options.*fetchOptions/i),
      expect.stringMatching(/inputs\[1\]\.mappedTo must be one of:.*USERS/i)
    ]))
  })

  it('enforces option-source modes and their field-type boundaries', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs = [
      {
        field: 'status',
        title: 'Status',
        fieldType: 'radio',
        mappedTo: 'TAGS'
      },
      {
        field: 'owner',
        title: 'Owner',
        fieldType: 'select',
        fetchOptions: {
          url: 'https://example.com/owners',
          serviceName: 'contacts',
          route: '/owners'
        }
      },
      {
        field: 'message',
        title: 'Message',
        fieldType: 'string',
        options: [{ label: 'Unexpected', value: 'unexpected' }]
      },
      {
        field: 'dynamic_config_on_static_field',
        title: 'Invalid dynamic configuration',
        fieldType: 'string',
        dynamicFieldsConfig: { url: 'https://example.com/dynamic' }
      }
    ]

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/inputs\[0\]\.mappedTo is not supported for radio/i),
      expect.stringMatching(/inputs\[1\]\.fetchOptions must define exactly one source/i),
      expect.stringMatching(/inputs\[2\]\.options is supported only for select, multiselect, or radio/i),
      expect.stringMatching(/inputs\[3\]\.dynamicFieldsConfig is supported only for DYNAMIC/i)
    ]))
  })

  it('allows only one dynamic input and one dynamic-field source per action version', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs = [
      {
        field: 'DYNAMIC',
        title: 'First dynamic section',
        fieldType: 'DYNAMIC',
        required: false,
        dynamicFieldsConfig: {
          url: 'https://example.com/dynamic',
          customGenerator: '(input) => input'
        }
      },
      {
        field: 'DYNAMIC',
        title: 'Second dynamic section',
        fieldType: 'DYNAMIC',
        required: false,
        dynamicFieldsConfig: { url: 'https://example.com/other-dynamic' }
      }
    ]

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/dynamicFieldsConfig must define exactly one source/i),
      expect.stringMatching(/inputs may contain at most one DYNAMIC field/i)
    ]))
  })

  it('validates input default values and field-specific validation support', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs = [
      {
        field: 'message',
        title: 'Message',
        fieldType: 'string',
        value: 42
      },
      {
        field: 'attachment',
        title: 'Attachment',
        fieldType: 'attachment',
        value: 'https://example.com/file.pdf'
      },
      {
        field: 'DYNAMIC',
        title: 'Dynamic section',
        fieldType: 'DYNAMIC',
        dynamicFieldsConfig: { url: 'https://example.com/dynamic' },
        validations: [{ rule: 'isValidEmail', errorMessage: 'Invalid email' }]
      }
    ]

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/inputs\[0\]\.value must be a string/),
      expect.stringMatching(/inputs\[1\]\.value is not supported for attachment/i),
      expect.stringMatching(/inputs\[2\]\.validations are not supported for DYNAMIC/i)
    ]))
  })

  it('accepts the static branch configuration produced by the marketplace UI', () => {
    const valid = structuredClone(validManifest) as any
    valid.actions[0].versions[0].branchesConfig = {
      info: {
        sectionTitle: 'Delivery result',
        sectionDescription: 'Choose how the workflow continues.',
        branchNameLabel: 'Branch name',
        branchNameHelpText: 'Name this workflow path.',
        deleteAlertTitle: 'Delete branch?',
        deleteAlertDescription: 'This removes the workflow path.',
        addButtonLabel: 'Add branch',
        allowNewCondition: true,
        isDefaultBranchEditable: false,
        showBranchSection: true
      },
      fields: [
        {
          field: 'delivery_status',
          title: 'Delivery status',
          required: true,
          fieldType: 'select',
          options: [
            { label: 'Delivered', value: 'delivered' },
            { label: 'Failed', value: 'failed' }
          ]
        },
        {
          field: 'retry_count',
          title: 'Retry count',
          required: false,
          fieldType: 'numerical'
        }
      ],
      predefinedBranches: {
        branches: [
          {
            id: 'delivered-branch',
            branchName: 'Delivered',
            conditionType: 'default',
            fields: { delivery_status: 'delivered', retry_count: 0 }
          },
          {
            id: 'failed-branch',
            branchName: 'Failed',
            conditionType: 'user-defined',
            fields: { delivery_status: 'failed' }
          }
        ]
      }
    }

    expect(validateWorkflowActionsManifest(valid)).toEqual([])
  })

  it('requires unique branch IDs and explicit condition types', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].branchesConfig = {
      predefinedBranches: {
        branches: [
          { branchName: 'Missing identity', fields: {} },
          { id: 'duplicate', branchName: 'First duplicate', conditionType: 'default', fields: {} },
          { id: 'duplicate', branchName: 'Second duplicate', conditionType: 'default', fields: {} }
        ]
      }
    }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/branches\[0\]\.id must be a non-empty string/),
      expect.stringMatching(/branches\[0\]\.conditionType must be a non-empty string/),
      expect.stringMatching(/branches\[2\]\.id duplicates branch ID "duplicate"/)
    ]))
  })

  it('requires predefined branch metadata to be an object', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].branchesConfig = {
      predefinedBranches: {
        branches: [{
          id: 'delivered-branch',
          branchName: 'Delivered',
          conditionType: 'default',
          fields: {},
          meta: []
        }]
      }
    }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/branches\[0\]\.meta must be an object/)
    ]))
  })

  it('validates branch field references and dynamic fetch configuration', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].branchesConfig = {
      fields: [{ field: 'delivery status', title: 'Delivery status', fieldType: 'string' }],
      predefinedBranches: { fetchBranches: { route: '' } }
    }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/fields\[0\]\.field must not contain whitespace/),
      expect.stringMatching(/fetchBranches\.serviceName must be a non-empty string/),
      expect.stringMatching(/fetchBranches\.route must be a non-empty string/)
    ]))
  })

  it('validates predefined branch values against their field definitions', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].branchesConfig = {
      fields: [
        {
          field: 'delivery_status',
          title: 'Delivery status',
          required: true,
          fieldType: 'select',
          options: [{ label: 'Delivered', value: 'delivered' }]
        },
        {
          field: 'labels',
          title: 'Labels',
          required: true,
          fieldType: 'multiselect',
          options: [{ label: 'Priority', value: 'priority' }]
        },
        { field: 'attempts', title: 'Attempts', fieldType: 'numerical' },
        { field: 'billable', title: 'Billable', fieldType: 'toggle' },
        { field: 'message', title: 'Message', required: true, fieldType: 'string' }
      ],
      predefinedBranches: {
        branches: [
          {
            id: 'invalid-branch',
            branchName: 'Invalid branch',
            conditionType: 'default',
            fields: {
              delivery_status: 'unknown',
              labels: ['priority', 'unknown'],
              attempts: 'two',
              billable: 'yes',
              unsupported: true
            }
          }
        ]
      }
    }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/fields\.unsupported does not match a configured branch field/),
      expect.stringMatching(/fields\.message is required/),
      expect.stringMatching(/fields\.delivery_status must be one of: delivered/),
      expect.stringMatching(/fields\.labels\[1\] must be one of: priority/),
      expect.stringMatching(/fields\.attempts must be a finite number/),
      expect.stringMatching(/fields\.billable must be a boolean/)
    ]))
  })

  it('validates nested input presentation and dynamic-source configuration', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs[0] = {
      field: 'channel',
      title: 'Channel',
      fieldType: 'select',
      options: [{ label: 'Email', value: 'email' }],
      config: { richTextEditorType: 'markdown' },
      fieldOptions: { allowedFileTypes: 'pdf' },
      variant: 'tile-picker',
      variantConfig: { columns: 8, tileSize: 'xl', allowDeselect: 'yes' },
      dynamicSource: { url: 'https://example.com/options', method: 'TRACE' }
    }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/config\.richTextEditorType/),
      expect.stringMatching(/fieldOptions\.allowedFileTypes must be an array/),
      expect.stringMatching(/variantConfig\.columns must be an integer between 2 and 5/),
      expect.stringMatching(/variantConfig\.tileSize/),
      expect.stringMatching(/variantConfig\.allowDeselect must be a boolean/),
      expect.stringMatching(/dynamicSource\.method must be one of/)
    ]))
  })

  it('does not coerce untrusted rich-text editor modes before allowlist validation', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs[0].config = {
      richTextEditorType: { toString: () => 'html' }
    }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/config\.richTextEditorType must be "html" or "plain-text"/)
    ]))
  })

  it('enforces field-type-specific presentation and pagination rules', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs = [
      {
        field: 'message',
        title: 'Message',
        fieldType: 'textarea',
        variant: 'tile-picker',
        variantConfig: { columns: 3 }
      },
      {
        field: 'resource',
        title: 'Resource',
        fieldType: 'select_with_pagination'
      }
    ]

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/variant "tile-picker" is supported only/),
      expect.stringMatching(/dynamicSource is required for paginated select fields/)
    ]))
  })

  it('accepts the current backend action-input and code-backed dynamic-source fields', () => {
    const manifest = structuredClone(validManifest) as any
    manifest.actions[0].versions[0].inputs = [
      {
        field: 'line_items',
        title: 'Line items',
        fieldType: 'fieldSet',
        config: {
          innerFields: ['name', 'quantity'],
          addItemLabel: 'Add item',
          itemLabel: 'Item',
          minSets: 1,
          maxSets: 5
        },
        order: 1,
        showHelpTextAsInfoToolTip: true
      },
      {
        field: 'resource',
        title: 'Resource',
        fieldType: 'select_with_pagination',
        hasDynamicOptions: true,
        dynamicSource: {
          executionType: 'CODE',
          code: 'return { options: [] }',
          pagination: {
            enabled: true,
            strategy: 'cursor',
            cursorParam: 'cursor',
            nextCursorField: 'meta.next',
            limitValue: 100,
            order: 'asc',
            fetchAllPages: false
          }
        }
      },
      {
        field: 'start_date',
        title: 'Start date',
        fieldType: 'date',
        disableDatesFunction: '(params) => false'
      }
    ]
    manifest.actions[0].versions[0].sectionOrder = ['line_items', 'resource']
    manifest.actions[0].versions[0].groupConfigs = {
      advanced: { dividerPosition: 'below' }
    }

    expect(validateWorkflowActionsManifest(manifest)).toEqual([])
  })

  it('compares field-set limits only after both values pass integer validation', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs[0] = {
      field: 'line_items',
      title: 'Line items',
      fieldType: 'fieldSet',
      config: {
        innerFields: ['name'],
        minSets: Number.POSITIVE_INFINITY,
        maxSets: 1
      }
    }

    const invalidErrors = validateWorkflowActionsManifest(invalid)
    expect(invalidErrors).toEqual(expect.arrayContaining([
      expect.stringMatching(/config\.minSets must be a non-negative integer/)
    ]))
    expect(invalidErrors).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/config\.minSets must not exceed maxSets/)
    ]))

    invalid.actions[0].versions[0].inputs[0].config.minSets = 2
    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/config\.minSets must not exceed maxSets/)
    ]))
  })

  it('does not allow a new local action to preserve a remote secret that cannot exist yet', () => {
    const invalid = structuredClone(validManifest) as any
    delete invalid.actions[0].templateId
    invalid.actions[0].versions[0].executionConfig.headers.Authorization = '${remote}'

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/headers\.Authorization cannot use "\$\{remote\}".*new local action/)
    ]))
  })

  it('checks custom code and arrow-function validation syntax without executing either', () => {
    const invalid = structuredClone(validManifest) as any
    const version = invalid.actions[0].versions[0]
    version.executionConfig = { type: 'CODE', code: 'if (' }
    version.inputs[0].validations = [{ rule: '(value) => {', errorMessage: 'Invalid' }]

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/validations\[0\]\.rule contains invalid arrow-function syntax/),
      expect.stringMatching(/executionConfig\.code contains invalid JavaScript/)
    ]))
  })

  it.each([
    ['a primitive expression', '42'],
    ['an assignment expression', 'globalThis.compromised = true'],
    ['an immediately invoked function', '(() => true)()'],
    ['a sequence expression', '((globalThis.compromised = true), (value) => value)']
  ])('rejects %s where a function expression is required', (_case, expression) => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs[0].disableDatesFunction = expression

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/disableDatesFunction contains invalid function syntax/)
    ]))
  })

  it('accepts named function expressions without executing them', () => {
    const valid = structuredClone(validManifest) as any
    valid.actions[0].versions[0].inputs[0].disableDatesFunction =
      'function isDisabled(params) { throw new Error(String(params)) }'

    expect(validateWorkflowActionsManifest(valid)).toEqual([])
  })

  it('bounds regular-expression validation rules', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs[0].validations = [{
      rule: 'a'.repeat(1_001),
      errorMessage: 'Invalid'
    }]

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/validations\[0\]\.rule must be at most 1,000 characters/)
    ]))
  })

  it('accepts valid regex rules and rejects malformed patterns', () => {
    const valid = structuredClone(validManifest) as any
    valid.actions[0].versions[0].inputs[0].validations = [{
      rule: '^[a-z0-9_-]+$',
      errorMessage: 'Invalid'
    }]
    const invalid = structuredClone(valid) as any
    invalid.actions[0].versions[0].inputs[0].validations[0].rule = '[unterminated'

    expect(validateWorkflowActionsManifest(valid)).toEqual([])
    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/validations\[0\]\.rule must be a predefined validation, a valid regular expression, or an arrow function/)
    ]))
  })

  it('does not let wall-clock scheduling change regex safety results', () => {
    const valid = structuredClone(validManifest) as any
    valid.actions[0].versions[0].inputs[0].validations = [{
      rule: '^[a-z0-9_-]+$',
      errorMessage: 'Invalid'
    }]
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(1_000)

    try {
      expect(validateWorkflowActionsManifest(valid)).toEqual([])
    } finally {
      now.mockRestore()
    }
  })

  it.each([
    ['nested repetition', '^(a+)+$'],
    ['repeated character group', '^([a-zA-Z]+)*$'],
    ['overlapping alternatives', '^(a|aa)+$'],
    ['overlapping optional alternatives', '^(a|a?)+$'],
    ['backreferences', '^(a.*)\\1$']
  ])('rejects ReDoS-prone regex rules with %s', (_case, rule) => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs[0].validations = [{ rule, errorMessage: 'Invalid' }]

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/validations\[0\]\.rule must not allow ambiguous backtracking/)
    ]))
  })

  it.each([
    ['line breaks', 'prefix\nsuffix'],
    ['control characters', 'prefix\u0000suffix'],
    ['non-ASCII characters', '^café$']
  ])('rejects regex rules containing %s', (_case, rule) => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].inputs[0].validations = [{ rule, errorMessage: 'Invalid' }]

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/validations\[0\]\.rule may contain only printable ASCII characters/)
    ]))
  })

  it('limits custom code by UTF-8 payload size', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].executionConfig = {
      type: 'CODE',
      code: `return "${'é'.repeat(Math.floor(WORKFLOW_ACTION_CODE_MAX_BYTES / 2) + 1)}"`
    }

    expect(validateWorkflowActionsManifest(invalid)).toEqual(expect.arrayContaining([
      expect.stringMatching(/executionConfig\.code must be at most 1 MiB/)
    ]))
  })

  it('enforces the app white-label setting for customer-visible action text', () => {
    const invalid = structuredClone(validManifest) as any
    invalid.actions[0].versions[0].info.name = 'GHL message sender'

    expect(validateWorkflowActionsManifest(invalid, { whiteLabel: true })).toEqual(expect.arrayContaining([
      expect.stringMatching(/info\.name.*white-label/i)
    ]))
    expect(validateWorkflowActionsManifest(invalid, { whiteLabel: false })).toEqual([])
  })
})
