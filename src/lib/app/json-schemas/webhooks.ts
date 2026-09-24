import {
  RESOURCE_IDENTIFIER_PATTERN,
  WEBHOOK_EVENT_PATTERN,
  arrayOf,
  nonBlankString,
  object,
  optionalHttpsUrl,
  requiredHttpsUrl,
  rootSchema,
  type JsonSchema
} from './builders.js'

const webhookBaseSchema = rootSchema(
  'webhooks',
  'HighLevel Webhook Manifest',
  {
    schemaVersion: { const: 1, description: 'Generated webhook manifest schema version.' },
    appId: {
      type: 'string',
      pattern: RESOURCE_IDENTIFIER_PATTERN,
      description: 'Read-only HighLevel app identifier from the last pull.'
    },
    versionId: {
      type: 'string',
      pattern: RESOURCE_IDENTIFIER_PATTERN,
      description: 'Read-only HighLevel app version identifier from the last pull.'
    },
    webhookUrl: optionalHttpsUrl(
      'Default webhook URL. It must use public HTTPS when subscribedEvents contains an event.'
    ),
    subscribedEvents: arrayOf(
      object(
        {
          name: nonBlankString({
            maxLength: 200,
            pattern: WEBHOOK_EVENT_PATTERN,
            description: 'Webhook event name from the live event catalog.'
          }),
          url: optionalHttpsUrl('Optional event-specific override URL; must use public HTTPS.')
        },
        ['name']
      ),
      {
        description: 'Webhook event subscriptions. Event names must be unique and allowed by the selected OAuth scopes.'
      }
    )
  },
  ['schemaVersion', 'appId', 'versionId', 'webhookUrl', 'subscribedEvents']
)

export const webhookSchema: JsonSchema = {
  ...webhookBaseSchema,
  description: 'Editable webhook settings. The CLI also verifies public hosts and the live scope-to-event catalog.',
  allOf: [
    {
      if: { properties: { subscribedEvents: { minItems: 1 } }, required: ['subscribedEvents'] },
      then: { properties: { webhookUrl: requiredHttpsUrl('Required default public HTTPS webhook URL.') } }
    }
  ]
}
