import {
  HEADER_NAME_PATTERN,
  booleanValue,
  nonEmptyString,
  object,
  optionalHttpsUrl,
  requiredHttpsUrl,
  stringArray,
  stringValue,
  type JsonSchema
} from './builders.js'

export const headersSchema = (): JsonSchema => ({
  type: 'object',
  propertyNames: { pattern: HEADER_NAME_PATTERN },
  additionalProperties: nonEmptyString(),
  description: 'HTTP header names and non-empty values. Header names must use RFC token characters.'
})

export const workflowInfoSchema = (limits = false): JsonSchema =>
  object(
    {
      name: nonEmptyString({ description: 'Marketplace display name.' }),
      description: {
        type: 'string',
        ...(limits ? { maxLength: 200 } : {}),
        description: limits ? 'Description with at most 200 characters.' : 'Marketplace description.'
      },
      summary: {
        type: 'string',
        ...(limits ? { maxLength: 500 } : {}),
        description: limits ? 'Summary with at most 500 characters.' : 'Marketplace summary.'
      },
      groupName: stringValue({ description: 'Optional workflow picker group.' }),
      keywords: stringArray({ description: 'Workflow search keywords.' }),
      icon: stringValue({ description: 'Optional icon identifier.' }),
      screenshots: stringArray(
        { description: 'Public HTTPS screenshot URLs.' },
        requiredHttpsUrl('Public HTTPS workflow screenshot URL.')
      )
    },
    ['name']
  )

export const workflowOptionSchema = (): JsonSchema =>
  object(
    {
      label: nonEmptyString({ description: 'Option label shown to users.' }),
      value: nonEmptyString({ description: 'Unique option value within the option list.' }),
      description: stringValue({ description: 'Optional option description.' }),
      disabled: booleanValue({ description: 'Whether this option is disabled.' }),
      icon: stringValue({ description: 'Optional icon identifier.' }),
      iconUrl: optionalHttpsUrl('Optional public HTTPS option icon URL.')
    },
    ['label', 'value']
  )
