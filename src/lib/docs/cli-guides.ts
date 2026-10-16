import { buildManagedCommandReference } from '../app/command-reference.js'
import { getJsonSchema, JSON_SCHEMA_NAMES, type JsonSchemaName } from '../app/json-schema.js'
import { buildHighLevelAppGuide } from '../app/structure-guide.js'
import { buildBillingGuide } from '../billing/guide.js'
import { CodedError } from '../shared/errors.js'
import { buildWorkflowActionsGuide } from '../workflows/actions/guide.js'
import { buildWorkflowTriggersGuide } from '../workflows/triggers/guide.js'
import { type DocEntry, type GuidePage, pageEntries } from './catalog.js'
import { findHeadings } from './markdown.js'
import type { DocLocation } from './source.js'

/* The CLI's own references, served without a network: the guides it writes
   into every app workspace and the JSON Schemas that validate the workspace
   files. They are addressed as `ghl-cli:<topic>` and `ghl-cli:schema/<name>`. */
export const CLI_DOCS_SCHEME = 'ghl-cli:'
const SCHEMA_PREFIX = 'schema/'
const SECTION = 'CLI workspace'
const MANAGED_MARKER = /^<!--.*-->$/
const MAX_ANCHOR_LENGTH = 200

const CLI_GUIDES: Readonly<Record<string, () => string>> = {
  app: buildHighLevelAppGuide,
  'workflow-actions': buildWorkflowActionsGuide,
  'workflow-triggers': buildWorkflowTriggersGuide,
  billing: buildBillingGuide,
  commands: () => `# HighLevel CLI command reference\n\n${buildManagedCommandReference()}`
}

const SCHEMA_FILES: Readonly<Record<JsonSchemaName, string>> = {
  app: 'ghl-app.json',
  webhooks: 'src/webhooks/ghl-webhooks.json',
  'workflow-action': 'src/modules/workflows/actions/<name>.json',
  'workflow-trigger': 'src/modules/workflows/triggers/<name>.json',
  subscription: 'src/billing/subscription.json',
  'usage-based': 'src/billing/usage-based.json'
}

function isSchemaName(name: string): name is JsonSchemaName {
  return (JSON_SCHEMA_NAMES as readonly string[]).includes(name)
}

function guideText(topic: string): string {
  return CLI_GUIDES[topic]()
    .split('\n')
    .filter(line => !MANAGED_MARKER.test(line.trim()))
    .join('\n')
    .trim()
}

/* The full text behind a `ghl-cli:` URL, or undefined for any other URL. */
export function cliDocText(url: string): string | undefined {
  if (!url.startsWith(CLI_DOCS_SCHEME)) return undefined
  const topic = url.slice(CLI_DOCS_SCHEME.length)
  if (Object.hasOwn(CLI_GUIDES, topic)) return guideText(topic)
  const schema = topic.startsWith(SCHEMA_PREFIX) ? topic.slice(SCHEMA_PREFIX.length) : ''
  return isSchemaName(schema) ? JSON.stringify(getJsonSchema(schema)) : undefined
}

export function isCliDocUrl(input: string): boolean {
  return input.trim().toLowerCase().startsWith(CLI_DOCS_SCHEME)
}

export function resolveCliDocUrl(input: string): DocLocation {
  const [address, ...fragment] = input.trim().split('#')
  const url = `${CLI_DOCS_SCHEME}${address.slice(CLI_DOCS_SCHEME.length).toLowerCase()}`
  if (cliDocText(url) === undefined) {
    const topics = [...Object.keys(CLI_GUIDES), ...JSON_SCHEMA_NAMES.map(name => `${SCHEMA_PREFIX}${name}`)]
    throw new CodedError('DOC_NOT_FOUND', `Unknown CLI reference "${address}". Available: ${topics.join(', ')}.`)
  }
  const anchor = fragment.join('#').trim().toLowerCase()
  return anchor && anchor.length <= MAX_ANCHOR_LENGTH ? { url, anchor } : { url }
}

function guidePage(topic: string): GuidePage {
  const lines = guideText(topic).split('\n')
  const title = findHeadings(lines).find(heading => heading.level === 1)?.text ?? topic
  return { title, url: `${CLI_DOCS_SCHEME}${topic}`, lines }
}

function schemaEntry(name: JsonSchemaName): DocEntry {
  const schema = getJsonSchema(name) as { title?: string; description?: string; properties?: object }
  const keys = Object.keys(schema.properties ?? {}).filter(key => key !== '$schema')
  return {
    kind: 'cli',
    title: `JSON Schema: ${schema.title ?? name} (${SCHEMA_FILES[name]})`,
    url: `${CLI_DOCS_SCHEME}${SCHEMA_PREFIX}${name}`,
    section: SECTION,
    text: [schema.description, `Validates ${SCHEMA_FILES[name]}. Top-level keys: ${keys.join(', ')}.`]
      .filter(Boolean)
      .join(' ')
  }
}

export function cliDocEntries(): DocEntry[] {
  return [
    ...Object.keys(CLI_GUIDES).flatMap(topic => pageEntries(guidePage(topic), { kind: 'cli', section: SECTION })),
    ...JSON_SCHEMA_NAMES.map(schemaEntry)
  ]
}
