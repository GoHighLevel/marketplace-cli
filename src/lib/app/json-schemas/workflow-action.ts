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
  nonEmptyString,
  object,
  reference,
  rootSchema,
  stringArray,
  stringValue,
  type JsonSchema
} from './builders.js'
import { headersSchema, workflowInfoSchema, workflowOptionSchema } from './workflow-shared.js'

const actionDefinitions: Record<string, JsonSchema> = {
  actionInfo: workflowInfoSchema(),
  actionOption: workflowOptionSchema(),
  headers: headersSchema(),
  validationRule: object({ rule: nonEmptyString(), errorMessage: nonEmptyString() }, ['rule', 'errorMessage']),
  fetchOptions: object({
    url: stringValue(),
    queryParams: arbitraryObject(),
    headers: reference('headers'),
    route: stringValue(),
    serviceName: stringValue(),
    version: stringValue(),
    source: stringValue(),
    sourceId: stringValue(),
    body: arbitraryObject()
  }),
  dynamicFieldsConfig: object({
    url: stringValue(),
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
  dynamicSourceDetail: object({
    executionType: { enum: ['API', 'CODE'] },
    code: stringValue(),
    url: stringValue(),
    method: { enum: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'] },
    headers: reference('headers'),
    labelField: stringValue(),
    valueField: stringValue(),
    path: stringValue(),
    body: arbitraryObject(),
    postProcessor: stringValue()
  }),
  dynamicSource: object({
    executionType: { enum: ['API', 'CODE'] },
    code: stringValue(),
    url: stringValue(),
    method: { enum: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'] },
    headers: reference('headers'),
    labelField: stringValue(),
    valueField: stringValue(),
    path: stringValue(),
    body: arbitraryObject(),
    postProcessor: stringValue(),
    pagination: reference('pagination')
  }),
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
  actionInput: object(
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
      disableDatesFunction: stringValue(),
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
        type: { enum: ['API', 'CODE'] },
        url: stringValue(),
        method: { enum: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'] },
        headers: reference('headers'),
        codeFile: nonEmptyString(),
        pauseExecution: booleanValue()
      },
      ['type']
    ),
    allOf: [
      {
        if: { properties: { type: { const: 'API' } } },
        then: { not: { required: ['codeFile'] } }
      },
      {
        if: { properties: { type: { const: 'CODE' } } },
        then: {
          required: ['codeFile'],
          not: { anyOf: [{ required: ['url'] }, { required: ['method'] }, { required: ['headers'] }] }
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
  actionVersion: object(
    {
      version: {
        type: 'string',
        maxLength: WORKFLOW_VERSION_MAX_LENGTH,
        pattern: WORKFLOW_VERSION_PATTERN
      },
      status: { enum: ['draft', 'in_review', 'published'] },
      info: reference('actionInfo'),
      inputs: arrayOf(reference('actionInput')),
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
  )
}

export const workflowActionSchema = rootSchema(
  'workflow-action',
  'HighLevel Workflow Action',
  {
    schemaVersion: { const: 1 },
    key: {
      type: 'string',
      minLength: 1,
      maxLength: WORKFLOW_ACTION_KEY_MAX_LENGTH,
      pattern: WORKFLOW_ACTION_KEY_PATTERN.source
    },
    templateId: nonEmptyString(),
    versions: arrayOf(reference('actionVersion'), { minItems: 1 })
  },
  ['schemaVersion', 'key', 'versions'],
  actionDefinitions
)
