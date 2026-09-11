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
  optionalHttpUrl,
  reference,
  requiredHttpUrl,
  requiredHttpsUrl,
  rootSchema,
  type JsonSchema
} from './builders.js'
import { headersSchema, workflowInfoSchema, workflowOptionSchema } from './workflow-shared.js'

const forbidProperties = (...properties: string[]): JsonSchema => ({
  not: { anyOf: properties.map(property => ({ required: [property] })) }
})

const exactlyOneProperty = (...properties: string[]): JsonSchema => ({
  oneOf: properties.map(property => ({ required: [property] }))
})

const triggerDefinitions: Record<string, JsonSchema> = {
  triggerInfo: workflowInfoSchema(true),
  triggerOption: workflowOptionSchema(),
  headers: headersSchema(),
  externalSource: object(
    {
      url: requiredHttpsUrl('Required public HTTPS external source URL.'),
      headers: reference('headers')
    },
    ['url']
  ),
  triggerFilter: {
    ...object(
      {
        field: {
          type: 'string',
          minLength: 1,
          maxLength: WORKFLOW_REFERENCE_MAX_LENGTH,
          pattern: '^\\S+$',
          description: 'Filter field or customVarsJson reference. Field names must be unique within the version.'
        },
        title: nonEmptyString({ description: 'Filter label shown to users.' }),
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
    description: 'Workflow trigger filter. Option sources and dynamic settings depend on fieldType.',
    allOf: [
      {
        if: { properties: { fieldType: { enum: ['select', 'multiselect'] } }, required: ['fieldType'] },
        then: exactlyOneProperty('options', 'mappedTo', 'fetchOptions')
      },
      {
        if: {
          properties: { fieldType: { not: { enum: ['select', 'multiselect'] } } },
          required: ['fieldType']
        },
        then: forbidProperties('options', 'mappedTo', 'fetchOptions')
      },
      {
        if: { properties: { fieldType: { const: 'DYNAMIC' } }, required: ['fieldType'] },
        then: {
          properties: { field: { const: 'DYNAMIC' }, required: { not: { const: true } } },
          required: ['dynamicFieldsConfig'],
          ...forbidProperties('altersDynamicField')
        },
        else: forbidProperties('dynamicFieldsConfig')
      }
    ]
  },
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
  subscriptionConfig: {
    ...object({
      url: optionalHttpUrl('Public HTTP or HTTPS subscription callback URL.'),
      headers: reference('headers')
    }),
    description: 'Trigger subscription callback. Publishing requires a URL; configured headers also require one.',
    allOf: [
      {
        if: { properties: { headers: { type: 'object', minProperties: 1 } }, required: ['headers'] },
        then: {
          properties: { url: requiredHttpUrl('Required public HTTP or HTTPS subscription callback URL.') },
          required: ['url']
        }
      }
    ]
  },
  triggerVersion: {
    ...object(
      {
        version: {
          type: 'string',
          maxLength: WORKFLOW_VERSION_MAX_LENGTH,
          pattern: WORKFLOW_VERSION_PATTERN,
          description: 'Trigger version in x.y format, for example 1.0.'
        },
        status: { enum: ['draft', 'in_review', 'published'], description: 'Server-managed trigger version status.' },
        info: reference('triggerInfo'),
        filters: arrayOf(reference('triggerFilter'), {
          description: 'Trigger filters. The CLI also checks unique fields and permits at most one DYNAMIC filter.'
        }),
        customVars: arrayOf(reference('triggerCustomVariable')),
        customVarsJson: arbitraryObject(),
        subscriptionConfig: reference('subscriptionConfig')
      },
      ['version', 'status', 'info']
    ),
    description:
      'A workflow trigger version. Publish-only completeness and reference resolution are checked by the CLI.',
    allOf: [
      {
        if: { properties: { customVars: { minItems: 1 } }, required: ['customVars'] },
        then: { properties: { customVarsJson: { type: 'object', minProperties: 1 } }, required: ['customVarsJson'] }
      }
    ]
  }
}

const workflowTriggerBaseSchema = rootSchema(
  'workflow-trigger',
  'HighLevel Workflow Trigger',
  {
    schemaVersion: { const: 1, description: 'Generated workflow trigger file schema version.' },
    key: {
      type: 'string',
      minLength: 1,
      maxLength: WORKFLOW_ACTION_KEY_MAX_LENGTH,
      pattern: WORKFLOW_ACTION_KEY_PATTERN.source,
      description: 'Stable trigger key. It must match the filename-derived key.'
    },
    templateId: nonEmptyString({ description: 'Server-owned template id. Omit it for a new local trigger.' }),
    versions: arrayOf(reference('triggerVersion'), {
      minItems: 1,
      description: 'Trigger versions. The CLI checks unique versions and allows at most one draft.'
    })
  },
  ['schemaVersion', 'key', 'versions'],
  triggerDefinitions
)

export const workflowTriggerSchema: JsonSchema = {
  ...workflowTriggerBaseSchema,
  description: 'One editable workflow trigger file under src/modules/workflows/triggers.',
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
                reference('triggerVersion'),
                { properties: { version: { const: '1.0' }, status: { const: 'draft' } } }
              ]
            }
          }
        }
      }
    }
  ]
}
