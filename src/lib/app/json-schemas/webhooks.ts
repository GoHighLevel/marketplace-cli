import { RESOURCE_IDENTIFIER_PATTERN, arrayOf, nonEmptyString, object, rootSchema, stringValue } from './builders.js'

export const webhookSchema = rootSchema(
  'webhooks',
  'HighLevel Webhook Manifest',
  {
    schemaVersion: { const: 1 },
    appId: { type: 'string', pattern: RESOURCE_IDENTIFIER_PATTERN },
    versionId: { type: 'string', pattern: RESOURCE_IDENTIFIER_PATTERN },
    webhookUrl: stringValue(),
    subscribedEvents: arrayOf(object({ name: nonEmptyString(), url: stringValue() }, ['name']))
  },
  ['schemaVersion', 'appId', 'versionId', 'webhookUrl', 'subscribedEvents']
)
