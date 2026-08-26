import {
  WORKFLOW_TRIGGER_FIELD_TYPES,
  WORKFLOW_TRIGGER_INTERNAL_REFERENCES,
  WORKFLOW_TRIGGER_REQUIRED_SCOPE
} from './contract.js'

export const WORKFLOW_TRIGGERS_GUIDE_FILENAME = 'HIGHLEVEL_WORKFLOW_TRIGGERS.md'

export function buildWorkflowTriggersGuide(): string {
  return `# HighLevel Workflow Triggers

This file is the complete authoring reference for marketplace workflow triggers managed by the HighLevel CLI. Trigger JSON is converted to the same API configuration used by the developer portal; customers continue to configure and use the published trigger through the HighLevel UI.

## Prerequisites

A trigger can be pushed or published only when the app:

- includes \`${WORKFLOW_TRIGGER_REQUIRED_SCOPE}\` in \`ghl-app.json.oauth.allowedScopes\`;
- has at least one OAuth redirect URI and one active client key; and
- includes \`Location\` in \`ghl-app.json.listing.userTypes\`.

The developer portal supports at most 20 marketplace triggers per app. Marketplace triggers are premium workflow components and are visible only when the app is installed and premium triggers/actions are enabled for the sub-account.

## Local structure and naming

\`\`\`text
src/modules/workflows/triggers/
├── HIGHLEVEL_WORKFLOW_TRIGGERS.md
├── contact-status-updated.json
└── order-created.json
\`\`\`

Each JSON file defines one trigger and every file is validated independently. Use lowercase letters, numbers, and hyphens, start with a letter, end with a letter or number, and retain the \`.json\` extension. Hyphens map to underscores in the immutable trigger key:

\`\`\`text
contact-status-updated.json -> contact_status_updated
\`\`\`

The JSON \`key\` must equal the filename-derived key. Keys may contain lowercase letters, numbers, and underscores, must start with a letter, and cannot be changed after the trigger is created. To change a key, create a new trigger and explicitly delete the old one.

## Complete trigger file

\`\`\`json
{
  "schemaVersion": 1,
  "key": "contact_status_updated",
  "templateId": "server-owned-id",
  "versions": [
    {
      "version": "1.1",
      "status": "draft",
      "info": {
        "name": "Contact Status Updated",
        "description": "Starts when an external contact status changes.",
        "summary": "Use this trigger to route contact status changes through a workflow.",
        "icon": "mdi-account-sync",
        "screenshots": ["https://cdn.example.com/contact-trigger.png"]
      },
      "customVarsJson": {
        "contact": { "id": "contact-123", "status": "qualified" },
        "tags": ["customer"]
      },
      "filters": [
        {
          "field": "contact.status",
          "title": "Status",
          "required": true,
          "fieldType": "select",
          "options": [
            { "label": "Qualified", "value": "qualified" },
            { "label": "Unqualified", "value": "unqualified" }
          ],
          "altersDynamicField": true
        }
      ],
      "customVars": [
        { "name": "Contact ID", "reference": "contact.id", "fieldType": "string" }
      ],
      "subscriptionConfig": {
        "url": "https://api.example.com/highlevel/subscriptions",
        "headers": { "Authorization": "\${env:TRIGGER_SUBSCRIPTION_TOKEN}" }
      }
    },
    {
      "version": "1.0",
      "status": "published",
      "info": { "name": "Contact Status Updated" }
    }
  ]
}
\`\`\`

## Root keys

| Key | Required | Ownership and purpose |
| --- | --- | --- |
| \`schemaVersion\` | Yes | Local file format. Must be \`1\`. |
| \`key\` | Yes | Immutable public identifier; must match the filename-derived key. |
| \`templateId\` | Existing trigger | Server-owned trigger ID. Omit it only for a new local trigger. |
| \`versions\` | Yes | Known versions, newest first. A trigger can have at most one draft. |

New local triggers must contain exactly one \`1.0\` draft and no \`templateId\`. Do not add versions or change \`status\` manually. Use \`ghl app triggers new-version <key>\`; the server clones the latest published version into the next editable draft.

## Version keys

| Key | Required | Purpose |
| --- | --- | --- |
| \`version\` | Yes | Server-owned \`major.minor\` version, such as \`1.0\`. |
| \`status\` | Yes | Server-owned \`draft\`, \`in_review\`, or \`published\`. Only drafts are editable. |
| \`info\` | Yes | Customer-facing trigger information. |
| \`customVarsJson\` | When references are used | Sample trigger payload used to select filter and custom-variable references. |
| \`filters\` | No | Fields customers configure when adding the trigger to a workflow. |
| \`customVars\` | No | Values from trigger data exposed to later workflow steps. |
| \`subscriptionConfig\` | Before publish | Callback HighLevel calls when a workflow creates, updates, or deletes this trigger. |

The CLI maps \`customVarsJson\` to both backend field names required by the current portal and workflow runtime. Do not add \`sampleResponseJson\` manually.

## Trigger information

| Key | Required | Validation and purpose |
| --- | --- | --- |
| \`name\` | Yes | Name shown in the workflow builder. |
| \`description\` | No | Short subtitle, at most 200 characters. |
| \`summary\` | No | Detailed purpose and usage guidance, at most 500 characters. |
| \`icon\` | No | Icon identifier selected by the developer portal. |
| \`screenshots\` | No | Array of public HTTPS image URLs. |
| \`groupName\` | No | Compatibility grouping label preserved by pull. |
| \`keywords\` | No | Compatibility search-keyword array preserved by pull. |

White-label apps cannot use restricted HighLevel branding in \`name\`, \`description\`, or \`summary\`.

## Trigger data

\`customVarsJson\` must be a JSON object representing the payload your application will POST to a workflow execution URL. It is sample data, not a schema and not a secret store. Use realistic value types because the CLI validates filter and custom-variable references against it.

Nested references use dot notation, for example \`contact.id\`. A reference must resolve to an existing value. Arrays used by custom variables should contain at least one sample item so their type can be inferred reliably.

## Filters

The developer portal exposes these filter types: ${WORKFLOW_TRIGGER_FIELD_TYPES.map(type => '`' + type + '`').join(', ')}.

Every filter supports these keys:

| Key | Required | Purpose |
| --- | --- | --- |
| \`field\` | Yes | Reference into \`customVarsJson\`; must not contain whitespace. Dynamic filters use exactly \`DYNAMIC\`. |
| \`title\` | Yes | Customer-visible filter label. |
| \`fieldType\` | Yes | One of the supported types above. |
| \`required\` | No | Whether a customer must configure the filter. Dynamic filters must be false or omitted. |
| \`altersDynamicField\` | No | Reloads the dynamic filter whenever this filter changes. Not valid on the dynamic filter itself. |
| \`options\` | Select/multiselect | Static label-value options. |
| \`mappedTo\` | Select/multiselect | A HighLevel internal option source. |
| \`fetchOptions\` | Select/multiselect | External HTTPS GET option source. |
| \`dynamicFieldsConfig\` | Dynamic | External HTTPS POST source that returns runtime filters. |

### String

\`\`\`json
{
  "field": "contact.email",
  "title": "Email",
  "fieldType": "string",
  "required": true
}
\`\`\`

### Select and multiselect

A \`select\` or \`multiselect\` filter must define exactly one option source: \`options\`, \`mappedTo\`, or \`fetchOptions\`.

Static constants:

\`\`\`json
{
  "field": "contact.status",
  "title": "Status",
  "fieldType": "select",
  "options": [
    { "label": "Open", "value": "open" },
    { "label": "Closed", "value": "closed", "description": "No further work", "disabled": false }
  ]
}
\`\`\`

Each option requires a unique, non-empty \`label\` and \`value\`. Optional keys are \`description\`, \`disabled\`, \`icon\`, and public HTTPS \`iconUrl\`.

HighLevel internal reference:

\`\`\`json
{
  "field": "tags",
  "title": "Tags",
  "fieldType": "multiselect",
  "mappedTo": "TAGS"
}
\`\`\`

Supported \`mappedTo\` values:

${WORKFLOW_TRIGGER_INTERNAL_REFERENCES.map(value => '- `' + value + '`').join('\n')}

External option API:

\`\`\`json
{
  "field": "country",
  "title": "Country",
  "fieldType": "select",
  "fetchOptions": {
    "url": "https://api.example.com/highlevel/countries",
    "headers": { "Authorization": "\${env:OPTIONS_API_TOKEN}" }
  }
}
\`\`\`

HighLevel calls \`fetchOptions.url\` with GET and expects:

\`\`\`json
{
  "options": [
    { "label": "United States", "value": "US" },
    { "label": "Canada", "value": "CA" }
  ]
}
\`\`\`

### Dynamic filter

Only one dynamic filter is allowed per trigger version. It always uses \`field: "DYNAMIC"\`, \`fieldType: "DYNAMIC"\`, and \`required: false\`.

\`\`\`json
{
  "field": "DYNAMIC",
  "title": "Additional filters",
  "fieldType": "DYNAMIC",
  "required": false,
  "dynamicFieldsConfig": {
    "url": "https://api.example.com/highlevel/dynamic-filters",
    "headers": { "Authorization": "\${env:DYNAMIC_FILTER_TOKEN}" }
  }
}
\`\`\`

HighLevel calls the URL with POST. The request contains current form \`data\`, location/workflow \`extras\`, and trigger \`meta\`:

\`\`\`json
{
  "data": { "country": "US", "status": "open" },
  "extras": { "locationId": "location-id", "contactId": "contact-id", "workflowId": "workflow-id" },
  "meta": { "key": "contact_status_updated", "version": "1.0" }
}
\`\`\`

Return a \`filters\` array using the same string/select/multiselect filter shape:

\`\`\`json
{
  "filters": [
    { "field": "region", "title": "Region", "fieldType": "string", "required": true },
    {
      "field": "priority",
      "title": "Priority",
      "fieldType": "select",
      "required": true,
      "options": [
        { "label": "High", "value": "high" },
        { "label": "Normal", "value": "normal" }
      ]
    }
  ]
}
\`\`\`

## Custom variables

Custom variables make selected trigger payload values available to later workflow actions.

| Key | Required | Purpose |
| --- | --- | --- |
| \`name\` | Yes | Customer-visible variable name. |
| \`reference\` | Yes | Unique dot-path into \`customVarsJson\`. |
| \`fieldType\` | Yes | \`string\`, \`numerical\`, \`boolean\`, \`date\`, or \`array\`; must match the sample value. |

\`\`\`json
{
  "customVars": [
    { "name": "Contact ID", "reference": "contact.id", "fieldType": "string" },
    { "name": "Order total", "reference": "order.total", "fieldType": "numerical" },
    { "name": "Tags", "reference": "tags", "fieldType": "array" }
  ]
}
\`\`\`

## Subscription callback

\`subscriptionConfig.url\` is required before publication. It may use public HTTP or HTTPS, although HTTPS is strongly recommended. HighLevel POSTs to this endpoint when a workflow trigger configuration is \`CREATED\`, \`UPDATED\`, or \`DELETED\`.

\`\`\`json
{
  "triggerData": {
    "id": "workflow-trigger-id",
    "key": "contact_status_updated",
    "filters": [
      {
        "field": "contact.status",
        "id": "contact.status",
        "operator": "==",
        "title": "Status",
        "type": "select",
        "value": "qualified"
      }
    ],
    "eventType": "UPDATED",
    "targetUrl": "https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/location-id/workflow-trigger-id"
  },
  "meta": { "key": "contact_status_updated", "version": "1.0" },
  "extras": { "locationId": "location-id", "workflowId": "workflow-id", "companyId": "company-id" }
}
\`\`\`

Store \`targetUrl\` by workflow trigger ID. Stop sending events after \`DELETED\`. To start the configured workflow, your application POSTs its event payload to that exact \`targetUrl\`. Contact data is optional; contactless workflows work as long as later actions do not require a contact.

## Header secrets

Sensitive header values must never be committed as literals. Use:

- \`\${env:VARIABLE_NAME}\` to read a value from the environment before push; or
- \`\${remote}\` to preserve the current remote value generated by pull.

Pull redacts sensitive headers to \`\${remote}\`. Push resolves every reference before the first mutation and fails without making changes if an environment variable or preserved remote value is unavailable. Ordinary representation headers such as \`Content-Type\` may remain literal.

## Commands and lifecycle

| Command | Purpose |
| --- | --- |
| \`ghl app triggers\` | List remote triggers for the workspace app or selected app. |
| \`ghl app triggers create <name> --key <key>\` | Add a local \`1.0\` draft file. No API is called. |
| \`ghl app triggers pull\` | Replace local trigger files and baseline with current portal state. |
| \`ghl app triggers validate\` | Validate every file locally without an API call. |
| \`ghl app triggers validate --publishable --trigger <key> [--version x.y]\` | Also enforce submission requirements. |
| \`ghl app triggers diff\` | Compare local files, last pull baseline, and current portal state. |
| \`ghl app triggers push --dry-run\` | Validate and show the exact API operations. |
| \`ghl app triggers push\` | Push only changed drafts; each trigger reports success or failure independently. |
| \`ghl app triggers new-version <key>\` | Ask the server to clone a published trigger into the next draft. |
| \`ghl app triggers publish <key> --notes "..." --force\` | Validate, submit the draft for review, publish it, and refresh local files. |
| \`ghl app triggers delete <key>\` | Remove the local file; the next push performs the irreversible remote deletion. |

There is no synthetic \`triggers test\` command. End-to-end testing requires a real workflow subscription callback and its server-issued \`targetUrl\`.

## Diff and API behavior

The source of truth is the portal. The CLI records the last pull in \`.ghl/workflow-triggers-state.json\` and performs a three-way comparison:

1. local JSON vs. last pull identifies developer edits;
2. current portal state vs. last pull identifies UI edits;
3. overlapping edits stop with a conflict and require a pull;
4. non-overlapping changes are merged, and only changed triggers call update APIs.

New keys are checked with the shared slug-availability endpoint before creation. Creating, updating, and deleting ten independent trigger files produces only the operations required for those files. Publishing is separate from pushing because it submits a release for review and updates the OAuth trigger registry.

Remote deletions are permanent. If a deleted trigger is already used in a workflow, its future execution is skipped.
`
}
