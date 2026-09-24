export const JSON_SCHEMA_NAMES = [
  'app',
  'webhooks',
  'workflow-action',
  'workflow-trigger',
  'subscription',
  'usage-based'
] as const

export type JsonSchemaName = (typeof JSON_SCHEMA_NAMES)[number]

export const JSON_SCHEMA_RELATIVE_PATHS: Readonly<Record<JsonSchemaName, string>> = {
  app: '.ghl/schemas/ghl-app.schema.json',
  webhooks: '.ghl/schemas/ghl-webhooks.schema.json',
  'workflow-action': '.ghl/schemas/ghl-workflow-action.schema.json',
  'workflow-trigger': '.ghl/schemas/ghl-workflow-trigger.schema.json',
  subscription: '.ghl/schemas/ghl-subscription.schema.json',
  'usage-based': '.ghl/schemas/ghl-usage-based.schema.json'
}

export const JSON_SCHEMA_REFERENCES: Readonly<Record<JsonSchemaName, string>> = {
  app: './.ghl/schemas/ghl-app.schema.json',
  webhooks: '../../.ghl/schemas/ghl-webhooks.schema.json',
  'workflow-action': '../../../../.ghl/schemas/ghl-workflow-action.schema.json',
  'workflow-trigger': '../../../../.ghl/schemas/ghl-workflow-trigger.schema.json',
  subscription: '../../.ghl/schemas/ghl-subscription.schema.json',
  'usage-based': '../../.ghl/schemas/ghl-usage-based.schema.json'
}
