import {
  HEADER_NAME_PATTERN,
  booleanValue,
  nonEmptyString,
  object,
  stringArray,
  stringValue,
  type JsonSchema
} from './builders.js'

export const headersSchema = (): JsonSchema => ({
  type: 'object',
  propertyNames: { pattern: HEADER_NAME_PATTERN },
  additionalProperties: nonEmptyString()
})

export const workflowInfoSchema = (limits = false): JsonSchema =>
  object(
    {
      name: nonEmptyString(),
      description: { type: 'string', ...(limits ? { maxLength: 200 } : {}) },
      summary: { type: 'string', ...(limits ? { maxLength: 500 } : {}) },
      groupName: stringValue(),
      keywords: stringArray(),
      icon: stringValue(),
      screenshots: stringArray()
    },
    ['name']
  )

export const workflowOptionSchema = (): JsonSchema =>
  object(
    {
      label: nonEmptyString(),
      value: nonEmptyString(),
      description: stringValue(),
      disabled: booleanValue(),
      icon: stringValue(),
      iconUrl: stringValue()
    },
    ['label', 'value']
  )
