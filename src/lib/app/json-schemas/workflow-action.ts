import { WORKFLOW_ACTION_FIELD_TYPES, WORKFLOW_ACTION_INTERNAL_REFERENCES } from '../../workflows/actions/contract.js'
import { WORKFLOW_ACTION_KEY_MAX_LENGTH, WORKFLOW_ACTION_KEY_PATTERN } from '../../workflows/actions/key.js'
import {
  WORKFLOW_FIELD_KEY_MAX_LENGTH,
  WORKFLOW_REFERENCE_MAX_LENGTH,
  WORKFLOW_VERSION_MAX_LENGTH
} from '../../workflows/shared/value-validation.js'
import {
  WORKFLOW_VERSION_PATTERN,
  arbitraryObject,
  arrayOf,
  booleanValue,
  integer,
  nonBlankString,
  nonEmptyString,
  object,
  optionalHttpUrl,
  optionalHttpsUrl,
  reference,
  requiredHttpsUrl,
  rootSchema,
  stringArray,
  stringValue,
  type JsonSchema
} from './builders.js'
import { headersSchema, workflowInfoSchema, workflowOptionSchema } from './workflow-shared.js'

const forbidProperties = (...properties: string[]): JsonSchema => ({
  not: { anyOf: properties.map(property => ({ required: [property] })) }
})

const exactlyOneProperty = (...properties: string[]): JsonSchema => ({
  oneOf: properties.map(property => ({ required: [property] }))
})

const dynamicSourceSchema = (pagination: boolean): JsonSchema => ({
  ...object({
    executionType: { enum: ['API', 'CODE'], description: 'Defaults to API when omitted.' },
    code: stringValue({ maxLength: 1_048_576, description: 'Inline JavaScript source for a CODE option source.' }),
    url: optionalHttpsUrl('Required public HTTPS URL for an API option source.'),
    method: { enum: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'] },
    headers: reference('headers'),
    labelField: stringValue(),
    valueField: stringValue(),
    path: stringValue(),
    body: arbitraryObject(),
    postProcessor: stringValue(),
    ...(pagination ? { pagination: reference('pagination') } : {})
  }),
  description: 'Dynamic option source using either an API request or JavaScript code.',
  allOf: [
    {
      if: { properties: { executionType: { const: 'CODE' } }, required: ['executionType'] },
      then: {
        properties: { code: nonBlankString({ maxLength: 1_048_576 }) },
        required: ['code'],
        ...forbidProperties('url', 'method', 'headers', 'labelField', 'valueField', 'path', 'body', 'postProcessor')
      },
      else: {
        properties: { url: requiredHttpsUrl('Required public HTTPS API option source URL.') },
        required: ['url'],
        ...forbidProperties('code')
      }
    }
  ]
})

const actionDefinitions: Record<string, JsonSchema> = {
  actionInfo: workflowInfoSchema(),
  actionOption: workflowOptionSchema(),
  headers: headersSchema(),
  validationRule: object(
    {
      rule: nonEmptyString({
        maxLength: 1_048_576,
        description:
          'Predefined validation name, safe regular expression of at most 1,000 characters, or arrow function.'
      }),
      errorMessage: nonEmptyString({ description: 'Validation message shown to users.' })
    },
    ['rule', 'errorMessage']
  ),
  fetchOptions: {
    ...object({
      url: optionalHttpsUrl('Public HTTPS option source URL.'),
      queryParams: arbitraryObject(),
      headers: reference('headers'),
      route: stringValue(),
      serviceName: stringValue(),
      version: stringValue(),
      source: stringValue(),
      sourceId: stringValue(),
      body: arbitraryObject()
    }),
    description: 'Exactly one option source: a public HTTPS URL or serviceName with route.',
    oneOf: [
      {
        properties: {
          url: requiredHttpsUrl('Required public HTTPS option source URL.'),
          serviceName: { const: '' },
          route: { const: '' }
        },
        required: ['url']
      },
      {
        properties: { url: { const: '' }, serviceName: nonEmptyString(), route: nonEmptyString() },
        required: ['serviceName', 'route']
      }
    ]
  },
  dynamicFieldsConfig: {
    ...object({
      url: optionalHttpsUrl('Public HTTPS dynamic-field source URL.'),
      headers: reference('headers'),
      route: stringValue(),
      serviceName: stringValue(),
      customGenerator: stringValue(),
      method: { enum: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'] },
      labelField: stringValue(),
      valueField: stringValue(),
      path: stringValue(),
      dependsOn: stringArray(),
      postProcessor: stringValue(),
      queryParams: arbitraryObject(),
      version: stringValue(),
      source: stringValue(),
      sourceId: stringValue(),
      body: arbitraryObject()
    }),
    description: 'Exactly one dynamic-field source: URL, customGenerator, or serviceName with route.',
    oneOf: [
      {
        properties: {
          url: requiredHttpsUrl('Required public HTTPS dynamic-field source URL.'),
          customGenerator: { const: '' },
          serviceName: { const: '' },
          route: { const: '' }
        },
        required: ['url']
      },
      {
        properties: {
          url: { const: '' },
          customGenerator: nonEmptyString(),
          serviceName: { const: '' },
          route: { const: '' }
        },
        required: ['customGenerator']
      },
      {
        properties: {
          url: { const: '' },
          customGenerator: { const: '' },
          serviceName: nonEmptyString(),
          route: nonEmptyString()
        },
        required: ['serviceName', 'route']
      }
    ]
  },
  pagination: object({
    strategy: { enum: ['limit_offset', 'page', 'last_page', 'cursor', 'next_url'] },
    pageParam: stringValue(),
    perPageParam: stringValue(),
    limitParam: stringValue(),
    offsetParam: stringValue(),
    cursorParam: stringValue(),
    nextCursorField: stringValue(),
    syncTokenField: stringValue(),
    syncTokenParam: stringValue(),
    searchParam: stringValue(),
    enabled: booleanValue(),
    perPageValue: integer(0),
    startingPage: integer(0),
    limitValue: integer(0),
    supportsSearch: booleanValue(),
    fetchAllPages: booleanValue(),
    order: { enum: ['asc', 'desc'] },
    searchDetail: reference('dynamicSourceDetail'),
    singleDetail: reference('dynamicSourceDetail')
  }),
  dynamicSourceDetail: dynamicSourceSchema(false),
  dynamicSource: dynamicSourceSchema(true),
  inputConfig: object({
    maxItems: integer(0),
    lockDefaultKeys: booleanValue(),
    addItemLabel: stringValue(),
    innerFields: stringArray(),
    itemLabel: stringValue(),
    minSets: integer(0),
    maxSets: integer(0),
    richTextEditorType: { enum: ['html', 'plain-text'] }
  }),
  fieldOptions: object({
    allowedFileTypes: stringArray(),
    showTextFiles: booleanValue(),
    showUrlFiles: booleanValue(),
    isClearable: booleanValue()
  }),
  variantConfig: object({
    columns: integer(2, 5),
    allowDeselect: booleanValue(),
    tileSize: { enum: ['sm', 'md', 'lg'] },
    showDescription: booleanValue()
  }),
  actionInput: {
    ...object(
      {
        field: {
          type: 'string',
          minLength: 1,
          maxLength: WORKFLOW_FIELD_KEY_MAX_LENGTH,
          pattern: '^(?:DYNAMIC|[A-Za-z][A-Za-z0-9_]*)$'
        },
        title: nonEmptyString(),
        required: booleanValue(),
        fieldType: { enum: [...WORKFLOW_ACTION_FIELD_TYPES] },
        helpText: stringValue(),
        placeholder: stringValue(),
        validations: arrayOf(reference('validationRule')),
        value: stringValue(),
        options: arrayOf(reference('actionOption'), { minItems: 1 }),
        mappedTo: { enum: ['', ...WORKFLOW_ACTION_INTERNAL_REFERENCES] },
        fetchOptions: reference('fetchOptions'),
        hasDynamicOptions: booleanValue(),
        dynamicSource: reference('dynamicSource'),
        dynamicFieldsConfig: reference('dynamicFieldsConfig'),
        altersDynamicField: booleanValue(),
        allowCustomInputPicker: booleanValue(),
        customInputHelperText: stringValue(),
        eventListeners: stringArray(),
        resetValue: booleanValue(),
        sortOptions: booleanValue(),
        order: integer(0),
        disabled: booleanValue(),
        dependentFilters: stringArray(),
        showOperator: booleanValue(),
        useArrayToArrayComparison: booleanValue(),
        config: reference('inputConfig'),
        showHelpTextAsInfoToolTip: booleanValue(),
        disableDatesFunction: nonBlankString({ description: 'JavaScript function expression used to disable dates.' }),
        postProcessor: stringValue(),
        showBelowCustomField: booleanValue(),
        fieldOptions: reference('fieldOptions'),
        timezoneSourceField: stringValue(),
        hideAIToggle: booleanValue(),
        variant: { enum: ['standard', 'tile-picker'] },
        variantConfig: reference('variantConfig'),
        group: stringValue(),
        groupDivider: booleanValue(),
        translationKey: stringValue()
      },
      ['field', 'title', 'fieldType']
    ),
    description: 'Workflow action input. Available option sources and settings depend on fieldType.',
    allOf: [
      {
        if: {
          properties: { fieldType: { enum: ['select', 'multiselect'] } },
          required: ['fieldType']
        },
        then: exactlyOneProperty('options', 'mappedTo', 'fetchOptions', 'dynamicSource')
      },
      {
        if: { properties: { fieldType: { const: 'radio' } }, required: ['fieldType'] },
        then: {
          ...exactlyOneProperty('options', 'fetchOptions', 'dynamicSource'),
          ...forbidProperties('mappedTo')
        }
      },
      {
        if: {
          properties: { fieldType: { enum: ['select_with_pagination', 'multiselect_with_pagination'] } },
          required: ['fieldType']
        },
        then: { required: ['dynamicSource'], ...forbidProperties('options', 'mappedTo', 'fetchOptions') }
      },
      {
        if: {
          properties: {
            fieldType: {
              not: {
                enum: ['select', 'multiselect', 'radio', 'select_with_pagination', 'multiselect_with_pagination']
              }
            }
          },
          required: ['fieldType']
        },
        then: forbidProperties('options', 'mappedTo', 'fetchOptions', 'dynamicSource')
      },
      {
        if: { properties: { fieldType: { const: 'DYNAMIC' } }, required: ['fieldType'] },
        then: {
          properties: { field: { const: 'DYNAMIC' }, required: { not: { const: true } } },
          required: ['dynamicFieldsConfig'],
          ...forbidProperties('value', 'validations')
        },
        else: forbidProperties('dynamicFieldsConfig')
      },
      {
        if: { properties: { fieldType: { enum: ['attachment', 'DYNAMIC'] } }, required: ['fieldType'] },
        then: forbidProperties('value')
      },
      {
        if: { properties: { fieldType: { enum: ['custom-html', 'DYNAMIC'] } }, required: ['fieldType'] },
        then: forbidProperties('validations')
      },
      {
        if: { properties: { variant: { const: 'tile-picker' } }, required: ['variant'] },
        then: { properties: { fieldType: { enum: ['select', 'multiselect', 'radio'] } } },
        else: forbidProperties('variantConfig')
      },
      {
        if: { properties: { fieldType: { const: 'key-value' } }, required: ['fieldType'] },
        then: {
          properties: {
            config: object({
              maxItems: integer(0),
              lockDefaultKeys: booleanValue(),
              addItemLabel: stringValue()
            })
          }
        }
      },
      {
        if: { properties: { fieldType: { const: 'fieldSet' } }, required: ['fieldType'] },
        then: {
          properties: {
            config: object(
              {
                innerFields: stringArray(),
                addItemLabel: stringValue(),
                itemLabel: stringValue(),
                minSets: integer(0),
                maxSets: integer(0)
              },
              ['innerFields']
            )
          }
        }
      },
      {
        if: {
          properties: { fieldType: { not: { enum: ['key-value', 'fieldSet'] } } },
          required: ['fieldType']
        },
        then: {
          properties: {
            config: object({ richTextEditorType: { enum: ['html', 'plain-text'] } })
          }
        }
      }
    ]
  },
  actionCustomVariable: object(
    {
      name: nonEmptyString(),
      reference: {
        type: 'string',
        minLength: 1,
        maxLength: WORKFLOW_REFERENCE_MAX_LENGTH,
        pattern: '^\\S+$'
      },
      fieldType: { enum: ['array', 'boolean', 'date', 'numerical', 'string'] },
      options: arrayOf(reference('actionOption'), { minItems: 1 }),
      fetchOptions: reference('fetchOptions')
    },
    ['name', 'reference', 'fieldType']
  ),
  executionConfig: {
    ...object(
      {
        type: { enum: ['API', 'CODE'], description: 'Execute an HTTP request or a local action code file.' },
        url: optionalHttpUrl('Public HTTP or HTTPS endpoint for API execution.'),
        method: { enum: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'] },
        headers: reference('headers'),
        codeFile: nonEmptyString({
          pattern: '^code/[a-z][_a-z0-9]*\\.\\d{1,10}\\.\\d{1,10}\\.(?:js|ts)$',
          description:
            'Local JavaScript or TypeScript source. The CLI verifies it matches this action key and version exactly.'
        }),
        pauseExecution: booleanValue()
      },
      ['type']
    ),
    description: 'Action execution settings. API and CODE properties are mutually exclusive.',
    allOf: [
      {
        if: { properties: { type: { const: 'API' } }, required: ['type'] },
        then: {
          ...forbidProperties('codeFile'),
          allOf: [
            {
              if: { properties: { url: nonBlankString() }, required: ['url'] },
              then: { required: ['method'] }
            }
          ]
        }
      },
      {
        if: { properties: { type: { const: 'CODE' } }, required: ['type'] },
        then: {
          required: ['codeFile'],
          ...forbidProperties('url', 'method', 'headers')
        }
      }
    ]
  },
  branchField: object(
    {
      field: { type: 'string', minLength: 1, maxLength: WORKFLOW_REFERENCE_MAX_LENGTH },
      title: nonEmptyString(),
      required: booleanValue(),
      fieldType: { enum: ['dynamic', 'multiselect', 'numerical', 'phone', 'select', 'string', 'textarea', 'toggle'] },
      options: arrayOf(reference('actionOption'), { minItems: 1 }),
      mappedTo: stringValue(),
      altersDynamicField: booleanValue(),
      disabled: booleanValue(),
      placeholder: stringValue(),
      helpText: stringValue(),
      value: stringValue(),
      sortOptions: booleanValue()
    },
    ['field', 'title', 'fieldType']
  ),
  branchInfo: object({
    branchNameLabel: stringValue(),
    branchNameHelpText: stringValue(),
    branchNamePlaceholder: stringValue(),
    sectionTitle: stringValue(),
    sectionDescription: stringValue(),
    deleteAlertTitle: stringValue(),
    deleteAlertDescription: stringValue(),
    addButtonLabel: stringValue(),
    allowNewCondition: booleanValue(),
    isDefaultBranchEditable: booleanValue(),
    showBranchSection: booleanValue()
  }),
  branchFetchOptions: object(
    {
      serviceName: nonEmptyString(),
      route: nonEmptyString(),
      version: stringValue(),
      source: stringValue(),
      sourceId: stringValue(),
      body: arbitraryObject(),
      headers: reference('headers')
    },
    ['serviceName', 'route']
  ),
  branch: object(
    {
      id: nonEmptyString(),
      branchName: nonEmptyString(),
      conditionType: { enum: ['default', 'user-defined'] },
      fields: arbitraryObject(),
      meta: arbitraryObject()
    },
    ['id', 'branchName', 'conditionType']
  ),
  branchesConfig: object({
    allowMultipath: booleanValue(),
    altersDynamicField: booleanValue(),
    info: reference('branchInfo'),
    fields: arrayOf(reference('branchField')),
    predefinedBranches: object({
      fetchBranches: reference('branchFetchOptions'),
      customGenerator: stringValue(),
      branches: arrayOf(reference('branch'))
    }),
    branchFieldsGenerator: stringValue()
  }),
  groupConfig: object({ dividerPosition: { enum: ['none', 'above', 'below'] } }),
  actionVersion: {
    ...object(
      {
        version: {
          type: 'string',
          maxLength: WORKFLOW_VERSION_MAX_LENGTH,
          pattern: WORKFLOW_VERSION_PATTERN,
          description: 'Action version in x.y format, for example 1.0.'
        },
        status: { enum: ['draft', 'in_review', 'published'], description: 'Server-managed action version status.' },
        info: reference('actionInfo'),
        inputs: arrayOf(reference('actionInput'), {
          description: 'Action inputs. The CLI also checks unique field names and permits at most one DYNAMIC input.'
        }),
        customVars: arrayOf(reference('actionCustomVariable')),
        customVarsJson: arbitraryObject(),
        executionConfig: reference('executionConfig'),
        payloadCustomizationType: { enum: ['custom', 'default'] },
        customizedPayload: arbitraryObject(),
        branchesConfig: reference('branchesConfig'),
        sectionOrder: stringArray({ uniqueItems: true }),
        groupConfigs: { type: 'object', additionalProperties: reference('groupConfig') }
      },
      ['version', 'status', 'info']
    ),
    description: 'A workflow action version. Publish-only completeness and JavaScript syntax are checked by the CLI.',
    allOf: [
      {
        if: { properties: { customVars: { minItems: 1 } }, required: ['customVars'] },
        then: { properties: { customVarsJson: { type: 'object', minProperties: 1 } }, required: ['customVarsJson'] }
      },
      {
        if: {
          properties: { payloadCustomizationType: { const: 'custom' } },
          required: ['payloadCustomizationType']
        },
        then: {
          properties: {
            customizedPayload: { type: 'object', minProperties: 1 },
            executionConfig: { properties: { type: { const: 'API' } }, required: ['type'] }
          },
          required: ['customizedPayload']
        }
      },
      {
        if: {
          properties: { payloadCustomizationType: { const: 'default' } },
          required: ['payloadCustomizationType']
        },
        then: { properties: { customizedPayload: { type: 'object', maxProperties: 0 } } }
      }
    ]
  }
}

const workflowActionBaseSchema = rootSchema(
  'workflow-action',
  'HighLevel Workflow Action',
  {
    schemaVersion: { const: 1, description: 'Generated workflow action file schema version.' },
    key: {
      type: 'string',
      minLength: 1,
      maxLength: WORKFLOW_ACTION_KEY_MAX_LENGTH,
      pattern: WORKFLOW_ACTION_KEY_PATTERN.source,
      description: 'Stable action key. It must match the filename-derived key.'
    },
    templateId: nonEmptyString({ description: 'Server-owned template id. Omit it for a new local action.' }),
    versions: arrayOf(reference('actionVersion'), {
      minItems: 1,
      description: 'Action versions. The CLI checks unique versions and allows at most one draft.'
    })
  },
  ['schemaVersion', 'key', 'versions'],
  actionDefinitions
)

export const workflowActionSchema: JsonSchema = {
  ...workflowActionBaseSchema,
  description: 'One editable workflow action file under src/modules/workflows/actions.',
  allOf: [
    {
      if: { not: { required: ['templateId'] } },
      then: {
        properties: {
          versions: {
            minItems: 1,
            maxItems: 1,
            items: {
              allOf: [
                reference('actionVersion'),
                { properties: { version: { const: '1.0' }, status: { const: 'draft' } } }
              ]
            }
          }
        }
      }
    }
  ]
}
