import { WORKFLOW_ACTION_KEY_MAX_LENGTH, WORKFLOW_ACTION_KEY_PATTERN } from '../../workflows/actions/key.js'
import { WORKFLOW_REFERENCE_MAX_LENGTH, WORKFLOW_VERSION_MAX_LENGTH } from '../../workflows/shared/value-validation.js'
import {
  WORKFLOW_TRIGGER_FIELD_TYPES,
  WORKFLOW_TRIGGER_INTERNAL_REFERENCES
} from '../../workflows/triggers/contract.js'
import {
  WORKFLOW_VERSION_PATTERN,
  arbitraryObject,
  arrayOf,
  booleanValue,
  nonEmptyString,
  object,
  reference,
  rootSchema,
  stringValue,
  type JsonSchema
} from './builders.js'
import { headersSchema, workflowInfoSchema, workflowOptionSchema } from './workflow-shared.js'

const triggerDefinitions: Record<string, JsonSchema> = {
  triggerInfo: workflowInfoSchema(true),
  triggerOption: workflowOptionSchema(),
  headers: headersSchema(),
  externalSource: object({ url: nonEmptyString(), headers: reference('headers') }, ['url']),
  triggerFilter: object(
    {
      field: { type: 'string', minLength: 1, maxLength: WORKFLOW_REFERENCE_MAX_LENGTH },
      title: nonEmptyString(),
      required: booleanValue(),
      fieldType: { enum: [...WORKFLOW_TRIGGER_FIELD_TYPES] },
      options: arrayOf(reference('triggerOption'), { minItems: 1 }),
      fetchOptions: reference('externalSource'),
      mappedTo: { enum: [...WORKFLOW_TRIGGER_INTERNAL_REFERENCES] },
      altersDynamicField: booleanValue(),
      dynamicFieldsConfig: reference('externalSource')
    },
    ['field', 'title', 'fieldType']
  ),
  triggerCustomVariable: object(
    {
      name: nonEmptyString(),
      reference: {
        type: 'string',
        minLength: 1,
        maxLength: WORKFLOW_REFERENCE_MAX_LENGTH,
        pattern: '^\\S+$'
      },
      fieldType: { enum: ['array', 'boolean', 'date', 'numerical', 'string'] }
    },
    ['name', 'reference', 'fieldType']
  ),
  subscriptionConfig: object({ url: stringValue(), headers: reference('headers') }),
  triggerVersion: object(
    {
      version: {
        type: 'string',
        maxLength: WORKFLOW_VERSION_MAX_LENGTH,
        pattern: WORKFLOW_VERSION_PATTERN
      },
      status: { enum: ['draft', 'in_review', 'published'] },
      info: reference('triggerInfo'),
      filters: arrayOf(reference('triggerFilter')),
      customVars: arrayOf(reference('triggerCustomVariable')),
      customVarsJson: arbitraryObject(),
      subscriptionConfig: reference('subscriptionConfig')
    },
    ['version', 'status', 'info']
  )
}

export const workflowTriggerSchema = rootSchema(
  'workflow-trigger',
  'HighLevel Workflow Trigger',
  {
    schemaVersion: { const: 1 },
    key: {
      type: 'string',
      minLength: 1,
      maxLength: WORKFLOW_ACTION_KEY_MAX_LENGTH,
      pattern: WORKFLOW_ACTION_KEY_PATTERN.source
    },
    templateId: nonEmptyString(),
    versions: arrayOf(reference('triggerVersion'), { minItems: 1 })
  },
  ['schemaVersion', 'key', 'versions'],
  triggerDefinitions
)
