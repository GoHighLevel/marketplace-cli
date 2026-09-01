export const APP_GUIDE_START = '<!-- ghl-cli-app-guide:start -->'
export const APP_GUIDE_END = '<!-- ghl-cli-app-guide:end -->'

export function buildHighLevelAppGuide(): string {
  return `${APP_GUIDE_START}
# HighLevel Marketplace App

## Overview

This directory is the local, code-friendly representation of one HighLevel marketplace app version. Developers edit supported configuration locally and use the GHL CLI to validate, compare, and synchronize it with the developer portal. The portal and marketplace APIs remain the source of truth.

## Workspace structure

\`\`\`text
<app-folder>/
├── ghl-app.json
├── AGENTS.md
├── CLAUDE.md
├── HIGHLEVEL_APP.md
├── .ghl/
│   ├── state.json
│   ├── workflow-actions-state.json
│   ├── workflow-triggers-state.json
│   └── billing-state.json
└── src/
    ├── billing/
    │   ├── HIGHLEVEL_BILLING.md
    │   ├── subscription.json
    │   └── usage-based.json
    ├── webhooks/
    │   └── ghl-webhooks.json
    └── modules/
        └── workflows/
            ├── actions/
            │   ├── HIGHLEVEL_WORKFLOW_ACTIONS.md
            │   ├── code/
            │   │   └── <action-key>.<version>.js
            │   └── <action-name>.json
            └── triggers/
                ├── HIGHLEVEL_WORKFLOW_TRIGGERS.md
                └── <trigger-name>.json
\`\`\`

- The \`billing\`, \`webhooks\`, \`actions\`, \`triggers\`, and action \`code\` directories are created only when their corresponding configuration exists.
- **\`ghl-app.json\`**: Supported app metadata and the app/version binding used by local commands.
- **\`src/webhooks/ghl-webhooks.json\`**: Configured app-level webhook URL and event subscriptions, kept separate from app metadata.
- **\`.ghl/state.json\`**: Last-pull baseline used for three-way diffing and conflict detection. It is CLI-managed and must not be edited.
- **\`src/modules/workflows/actions/<action-name>.json\`**: One JSON file per action, including every action-owned version. Its required \`key\` must match the key derived from the filename.
- **\`src/modules/workflows/actions/code/<action-key>.<version>.js\`**: JavaScript source for one code-backed action version, referenced by that version's \`executionConfig.codeFile\`.
- **\`src/modules/workflows/actions/HIGHLEVEL_WORKFLOW_ACTIONS.md\`**: Detailed action schema, naming, validation, and synchronization reference.
- **\`src/modules/workflows/triggers/<trigger-name>.json\`**: One JSON file per trigger, including every trigger-owned version and the filename-derived \`key\`.
- **\`src/modules/workflows/triggers/HIGHLEVEL_WORKFLOW_TRIGGERS.md\`**: Complete trigger schema, callback, execution, validation, and synchronization reference.
- **\`src/billing/subscription.json\`**: App-level marketplace plans; amounts and durations become immutable after creation.
- **\`src/billing/usage-based.json\`**: App-level usage meters and one or more non-overlapping price tiers.
- **\`src/billing/HIGHLEVEL_BILLING.md\`**: Complete billing field, validation, versioning, and synchronization reference.
- **\`.ghl/workflow-actions-state.json\`**: Separate last-pull baseline for workflow-action conflict detection. It is CLI-managed and must not be edited.
- **\`.ghl/workflow-triggers-state.json\`**: Separate last-pull baseline for workflow-trigger conflict detection. It is CLI-managed and must not be edited.
- **\`.ghl/billing-state.json\`**: Separate app-level subscription and meter baseline. It is CLI-managed and must not be edited.
- **\`AGENTS.md\`**: Workspace rules and the complete GHL CLI reference for AI coding agents.
- **\`CLAUDE.md\`**: The same operational guidance addressed specifically to Claude Code.
- **\`HIGHLEVEL_APP.md\`**: This structural reference for developers and AI agents.

Developer-owned source files may be added elsewhere in this directory. Pull and push only manage the documented CLI files and preserve unrelated files.

## App configuration sections

### Identity and version binding

- \`schemaVersion\` identifies the local manifest format.
- \`appId\` identifies the marketplace app.
- \`versionId\`, \`version\`, and \`status\` identify the represented portal version; optional \`createdAt\` is read-only metadata used for portal-parity eligibility checks.
- \`appType\` records the app type returned by the portal.

These values are CLI-managed. Do not edit them to point a workspace at another app or version.

### Basic information

\`basicInfo\` contains the app name, tagline, company and contact details, website, category, subcategories, business niches, and logo URL.

### Listing

\`listing\` controls public/private visibility, agency and sub-account targets, installer behavior, white-label compatibility, and marketplace search keywords.

### Profiles

\`profiles.agency\` contains the agency marketplace description, screenshots, and video. \`profiles.subAccount\` separately controls whether the sub-account profile is enabled and stores its description and media.

### OAuth

\`oauth\` contains allowed scopes, redirect URIs, default redirect/client-key references, and non-secret client-key metadata. Client secrets are one-time values stored in the CLI secret ledger and never written here.

### Support

\`supportConfig\` contains support contact details, documentation, terms, privacy-policy URLs, and supported services required for applicable app types.

### Billing

\`billing\` contains the billing model, external-billing settings, free-trial settings, and plan-derived summary fields. App-level subscription plans live in \`src/billing/subscription.json\`; usage meters and tiers live in \`src/billing/usage-based.json\`. Both files are omitted when empty and are synchronized with \`ghl app billing\` commands.

### Review

\`review\` contains demo URLs, non-secret reviewer notes, and the private-app reason. Review credentials are never exported to local JSON.

### Webhooks

\`src/webhooks/ghl-webhooks.json\` contains the default webhook URL plus subscribed event names and optional per-event URL overrides. Available events depend on the OAuth scopes configured for the app.

The \`webhook url\`, \`subscribe\`, and \`unsubscribe\` shortcuts require this workspace. They update the JSON atomically before the API call, validate and synchronize only webhook settings, verify the remote result, and then advance the baseline. A confirmed remote rejection restores the JSON; an uncertain result remains visible as a pending local change for \`app diff\` and \`app push\`.

### Workflow actions

Each JSON file directly under \`src/modules/workflows/actions/\` contains one action and the fields exposed by the workflow-action UI: action information, input fields and conditional option sources, response variables and schema, API or code execution, payload customization, pause behavior, and branching configuration.

The filename uses lowercase letters, numbers, and hyphens ending in \`.json\`. The CLI converts hyphens to underscores, so \`send-contact-sync-payload.json\` requires \`"key": "send_contact_sync_payload"\`. Each file has \`schemaVersion\`, the matching \`key\`, an API-owned \`templateId\` after creation, and a newest-first \`versions\` array. See \`src/modules/workflows/actions/HIGHLEVEL_WORKFLOW_ACTIONS.md\` for the complete contract.

For \`CODE\` execution, JSON stores only a deterministic \`codeFile\` reference. The CLI validates the JavaScript without executing it, then sends its contents to the portal as inline \`executionConfig.code\`. A version suffix keeps draft and published source independent.

\`customVarsJson\` contains representative response data. Each item in \`customVars\` contains \`name\`, a dot-separated \`reference\` to a selectable value in that response, and its inferred \`fieldType\`: \`string\`, \`boolean\`, \`numerical\`, or \`array\`. Objects and empty arrays cannot be selected as variables.

An empty \`branchesConfig\` means the UI branch toggle is disabled. A configured branch action uses \`info\` for branch-section labels, \`fields\` for unique whitespace-free value references, and \`predefinedBranches.branches\` for paths. Every path requires a unique \`id\`, a \`branchName\`, a \`conditionType\` of \`default\` or \`user-defined\`, and values matching the configured fields. For synchronous execution, the API or code result selects a path by returning \`{ "branchId": "<configured-id>" }\`.

Pulled actions can contain API-supported dynamic branch generators or fetch configuration. The CLI preserves and validates those fields, and branch fetch configuration requires \`serviceName\` and \`route\`. Use the static structure above when creating an action that should match the developer marketplace UI.

Workflow actions belong to the app, not to one marketplace app version. Each action has a stable \`key\`, a server-assigned \`templateId\`, and its own \`versions\` array. Only draft action versions are editable. Create a draft from a published action with \`ghl app actions new-version <key>\`.

Action execution headers can contain credentials. Pull replaces custom-header values with \`\${remote}\`; push preserves the current portal value. Use \`\${env:VARIABLE_NAME}\` to inject a new value during push without writing it to JSON. Standard content-negotiation headers may remain literal.

### Workflow triggers

Each JSON file under \`src/modules/workflows/triggers/\` contains one app-scoped trigger. It defines customer-facing information, representative event data in \`customVarsJson\`, workflow filters, downstream custom variables, and the subscription callback that receives workflow \`CREATED\`, \`UPDATED\`, and \`DELETED\` events.

The filename uses lowercase letters, numbers, and hyphens; hyphens map to underscores in the immutable \`key\`. Each existing trigger has a server-owned \`templateId\` and an independent newest-first \`versions\` array. Only drafts are editable. Read \`src/modules/workflows/triggers/HIGHLEVEL_WORKFLOW_TRIGGERS.md\` for every supported key and runtime payload.

Trigger callback, external-option, and dynamic-filter headers use the same \`\${remote}\` and \`\${env:VARIABLE_NAME}\` secret-reference rules as actions. The app must target locations and configure the \`workflows.readonly\` scope, a redirect URI, and a client key before triggers can be pushed or published.

## Intentionally excluded configuration

The local app model currently excludes external authentication, external configuration, MCP configuration, custom pages, secrets, credentials, install analytics, timestamps, and marketplace review workflow state. Manage excluded portal features through their dedicated CLI command when one exists or through the developer portal.

## Version model

An app can have multiple versions in the portal, but one local workspace represents one marketplace app version at a time. Workflow action and trigger versions are independent and remain app-scoped. Run \`ghl app versions\` for marketplace versions, or use the dedicated action and trigger commands for module versions.

## Local workflow

1. Run \`ghl app create\` for a new app or \`ghl app pull <appId>\` for an existing app.
2. Edit \`ghl-app.json\`, configured webhook/workflow files, and any billing files under \`src/billing/\`.
3. Run \`ghl app validate\` for local schema and conditional-field validation.
4. Run \`ghl app diff\` to inspect local changes, portal changes, conflicts, and required API sections.
5. Run \`ghl app push\` to validate again and push only supported changed sections.
6. Run \`ghl app validate --remote\` before publishing to check server-side marketplace readiness.
7. Run \`ghl app publish\` when the draft is ready for release or marketplace review.

For workflow actions, run \`ghl app actions validate\`, \`ghl app actions diff\`, and \`ghl app actions push\`. Use \`ghl app actions publish <key>\` only after the action push is clean.

For workflow triggers, run \`ghl app triggers validate\`, \`ghl app triggers diff\`, and \`ghl app triggers push\`. Use \`ghl app triggers publish <key>\` only after the trigger push is clean.

If the same field changed locally and in the portal, push stops without overwriting either value. Pull the portal version and then reapply the intended local change.

## Getting help

- Run \`ghl help <command>\` or append \`--help\` to any command for its current arguments, flags, and examples.
- Read \`AGENTS.md\` or \`CLAUDE.md\` for the complete categorized command reference and automation safety rules.
- Use the [HighLevel developer marketplace](https://marketplace.gohighlevel.com) to inspect the portal representation of this app.
${APP_GUIDE_END}`
}
