import { WORKFLOW_ACTION_FIELD_TYPES, WORKFLOW_ACTION_INTERNAL_REFERENCES } from './contract.js'

export const WORKFLOW_ACTIONS_GUIDE_FILENAME = 'HIGHLEVEL_WORKFLOW_ACTIONS.md'

export function buildWorkflowActionsGuide(): string {
  const fieldTypes = WORKFLOW_ACTION_FIELD_TYPES.map(type => `\`${type}\``).join(', ')
  const internalReferences = WORKFLOW_ACTION_INTERNAL_REFERENCES.map(reference => `\`${reference}\``).join(', ')

  return `# HighLevel Workflow Actions

## Purpose and prerequisite

Workflow actions add app-owned steps to HighLevel workflows. An action can collect configuration input, call an API or execute JavaScript, expose response values to later steps, pause execution, and route contacts through branches.

Add the \`workflows.readonly\` OAuth scope to the app so installed sub-accounts can discover its workflow actions. The HighLevel help article currently spells this scope incorrectly as \`workflows.readyonly\`; the actual OAuth scope is \`workflows.readonly\`.

The sub-account must have the marketplace app installed and LC Premium Triggers & Actions enabled. Workflow actions are premium features and can be charged per execution. An action belongs to the app, not to one marketplace app version; action versions have their own lifecycle.

## Local structure

\`\`\`text
src/modules/workflows/
├── actions/
│   ├── HIGHLEVEL_WORKFLOW_ACTIONS.md
│   ├── code/
│   │   ├── calculate_score.1.0.js
│   │   └── calculate_score.1.1.js
│   ├── calculate-score.json
│   └── send-contact-sync-payload.json
└── triggers/
\`\`\`

Each JSON file represents one action. The CLI aggregates these files internally as \`{ schemaVersion, appId, actions }\`; \`appId\` comes from the workspace's \`ghl-app.json\` and is never duplicated in an individual action file.

The \`triggers\` directory contains separate per-trigger JSON and its own generated \`HIGHLEVEL_WORKFLOW_TRIGGERS.md\` reference.

## Filename and stable key

Every action file contains a \`key\`. The filename independently derives the expected key, and the two must match.

- Use lowercase ASCII letters, numbers, and hyphens in the filename.
- Start with a letter, end with a letter or number, and use exactly one \`.json\` extension.
- Do not use spaces, underscores, uppercase letters, extra dots, or operating-system reserved names.
- The derived key must be at most 250 characters and cannot start with reserved \`lc_\` or \`iatf_\` prefixes.
- Every filename hyphen becomes an underscore: \`send-contact-sync-payload.json\` maps to \`send_contact_sync_payload\`.

The action \`key\` is immutable after remote creation. Renaming the file and changing \`key\` is treated as deleting one action and creating another.

## Action file keys

| Key | Required | Purpose |
| --- | --- | --- |
| \`schemaVersion\` | Yes | Local schema version. The only supported value is \`1\`. |
| \`key\` | Yes | Stable action identifier; must match the filename-derived key. |
| \`templateId\` | Remote actions | Server-owned action ID. Omit it for a new local action and never copy or edit it. |
| \`versions\` | Yes | All known action versions, newest first. A single action can have at most one \`draft\`. |

New local actions without \`templateId\` must contain exactly one \`1.0\` draft. The CLI adds \`templateId\` after the first successful push.

## Version keys

| Key | Required | Purpose |
| --- | --- | --- |
| \`version\` | Yes | Action version in \`major.minor\` form, such as \`1.0\`. |
| \`status\` | Yes | \`draft\`, \`in_review\`, or \`published\`. Only drafts can be edited. |
| \`info\` | Yes | Customer-visible action metadata. |
| \`inputs\` | For review | Fields displayed when a workflow user configures the action. |
| \`customVars\` | No | Response values exposed to later workflow steps. |
| \`customVarsJson\` | With custom variables | Representative action response used to resolve custom-variable references. |
| \`executionConfig\` | For review | Mutually exclusive API or code execution configuration. |
| \`payloadCustomizationType\` | No | \`default\` or \`custom\`; custom payloads are API-only. |
| \`customizedPayload\` | With custom payload | JSON body template used when payload mode is \`custom\`. |
| \`branchesConfig\` | No | Branch labels, fields, and predefined paths; \`{}\` disables branching. |
| \`sectionOrder\` | No | Ordered input field/group identifiers used by the workflow editor. |
| \`groupConfigs\` | No | Presentation settings keyed by group name. |

## Action information

| \`info\` key | Required | Purpose |
| --- | --- | --- |
| \`name\` | Yes | Action name shown in the workflow builder. |
| \`description\` | No | Short description shown as the action subtitle. |
| \`summary\` | No | Longer explanation of what the action does and why to use it. |
| \`groupName\` | No | Optional workflow-builder grouping label. |
| \`keywords\` | No | Search terms as an array of strings. |
| \`icon\` | No | Portal icon identifier shown with the action. |
| \`screenshots\` | No | Array of public HTTPS screenshot URLs. |

The current public portal edits \`name\`, \`description\`, \`summary\`, and \`icon\`. The remaining keys are preserved because they are part of the workflow action API contract.

## Input field types

The complete supported \`fieldType\` set is: ${fieldTypes}.

| Type | Value and behavior |
| --- | --- |
| \`string\` | Single-line text. |
| \`numerical\` | Numeric input. Use \`numerical\`, not the article's older \`numeric\` example. |
| \`textarea\` | Multi-line text. |
| \`select\` | One option from constants, an internal reference, or an external GET endpoint. |
| \`multiselect\` | Multiple options from one option source. |
| \`radio\` | One visible radio option. |
| \`toggle\` | Boolean toggle. |
| \`checkbox\` | Boolean checkbox. |
| \`attachment\` | File attachment; default \`value\` is not supported. |
| \`rich-text\` | Rich-text editor input. |
| \`hidden\` | Hidden value included in execution data, commonly IDs or mapped system values. |
| \`DYNAMIC\` | Fields returned by a POST endpoint. Only one \`DYNAMIC\` input is allowed per action. |
| \`date\` | Date input. |
| \`date-time\` | Date and time input. |
| \`phone\` | Phone-number input. |
| \`select_with_pagination\` | Backend-supported paginated single select using \`dynamicSource\`. |
| \`multiselect_with_pagination\` | Backend-supported paginated multi-select using \`dynamicSource\`. |
| \`custom-html\` | Backend-supported custom HTML presentation field. |
| \`tags\` | Backend-supported tag collection. |
| \`duration-picker\` | Backend-supported duration picker. |
| \`key-value\` | Repeating key/value input configured through \`config\`. |
| \`fieldSet\` | Repeating grouped fields configured through \`config\`. |

The developer portal currently creates the non-paginated types through \`phone\` plus \`DYNAMIC\`. Backend-compatible types are documented because pull preserves them, but developers should verify their availability in the target HighLevel environment before relying on them.

## Input keys

Each object in \`inputs\` supports the following keys.

| Key | Purpose |
| --- | --- |
| \`field\` | Required unique reference key. It starts with a letter and contains letters, numbers, or underscores. Dynamic input uses exactly \`DYNAMIC\`. |
| \`title\` | Required customer-visible field name. |
| \`required\` | Whether the workflow can be saved without a value. It must be false for \`DYNAMIC\`. |
| \`fieldType\` | One value from the complete type table above. |
| \`helpText\` | Supporting copy shown near the field. |
| \`placeholder\` | Empty-state input text. |
| \`validations\` | Ordered validation rules. Not supported on \`DYNAMIC\` or \`custom-html\`. |
| \`value\` | Default or mapped string value. It is not available for \`attachment\` or \`DYNAMIC\`. |
| \`options\` | Static option objects for select, multiselect, or radio inputs. |
| \`mappedTo\` | HighLevel internal-reference catalogue identifier for select or multiselect. The portal does not support it for radio. |
| \`fetchOptions\` | External GET option endpoint or backend internal request configuration for select-like inputs. |
| \`hasDynamicOptions\` | Compatibility flag indicating that options are resolved dynamically. |
| \`dynamicSource\` | Backend dynamic/paginated resolver for select-like inputs. |
| \`dynamicFieldsConfig\` | Source configuration available only on a \`DYNAMIC\` input. |
| \`altersDynamicField\` | Reload the dynamic field whenever this input changes. |
| \`allowCustomInputPicker\` | Allow standard entry or a workflow custom-value picker. |
| \`customInputHelperText\` | Helper copy for the custom-value picker. |
| \`eventListeners\` | Array of backend event-listener identifiers. |
| \`resetValue\` | Reset this input to its default when dependencies change. |
| \`sortOptions\` | Sort resolved options before display. |
| \`order\` | Non-negative display order. |
| \`disabled\` | Render the field as disabled. |
| \`dependentFilters\` | Array of sibling field references used by dependent inputs. |
| \`showOperator\` | Show a comparison-operator control. |
| \`useArrayToArrayComparison\` | Compare collection values as arrays. |
| \`config\` | Field-type-specific configuration described below. |
| \`showHelpTextAsInfoToolTip\` | Render help text in an information tooltip. |
| \`disableDatesFunction\` | Function expression returning whether a date is disabled. |
| \`postProcessor\` | Backend post-processing function/reference for resolved input data. |
| \`showBelowCustomField\` | Place the input below the workflow custom-field selector. |
| \`fieldOptions\` | Attachment or selection presentation settings. |
| \`timezoneSourceField\` | Sibling field containing an IANA timezone for date rendering. |
| \`hideAIToggle\` | Hide the workflow editor's AI-value toggle. |
| \`variant\` | \`standard\` or \`tile-picker\`; tile picker is select, multiselect, or radio only. |
| \`variantConfig\` | Tile-picker display configuration. |
| \`group\` | Input group identifier. |
| \`groupDivider\` | Show a divider for this input group. |
| \`translationKey\` | Translation catalogue key for backend-managed UI text. |

The current portal may preserve compatibility keys that are not exposed as controls. The CLI validates and round-trips them so a pull does not destroy server configuration.

## Static options

Select, multiselect, and radio inputs must define exactly one option source: \`options\`, \`mappedTo\`, \`fetchOptions\`, or backend-compatible \`dynamicSource\`. Do not combine sources. The current marketplace portal disables \`mappedTo\` for radio inputs. Other field types cannot carry these option-source keys.

Each \`options\` item supports:

| Key | Purpose |
| --- | --- |
| \`label\` | Required customer-visible option label. |
| \`value\` | Required unique stored string value. |
| \`description\` | Optional supporting text. |
| \`disabled\` | Whether the option is unavailable. |
| \`icon\` | Optional icon identifier, especially for tile pickers. |
| \`iconUrl\` | Optional public HTTPS image URL. |

## HighLevel internal references

\`mappedTo\` must be one of: ${internalReferences}.

These values ask HighLevel to load options from its own modules. The catalogue is validated locally so misspelled references never reach the API.

## External option API

\`fetchOptions\` loads select options from a URL using GET. A public configuration uses:

\`\`\`json
{
  "fetchOptions": {
    "url": "https://api.example.com/options",
    "queryParams": { "active": true },
    "headers": { "Authorization": "\${env:OPTIONS_TOKEN}" }
  }
}
\`\`\`

The endpoint must return \`{ "options": [{ "label": "Name", "value": "id" }] }\`.

Configure exactly one source inside \`fetchOptions\`: public \`url\`, or backend-managed \`serviceName\` with \`route\`. Never combine the two modes.

| \`fetchOptions\` key | Purpose |
| --- | --- |
| \`url\` | Public HTTPS GET endpoint. Required for marketplace actions. |
| \`queryParams\` | Object appended as query parameters. |
| \`headers\` | Request header object with secret-reference rules. |
| \`serviceName\` | Internal service identifier for backend-owned action configurations. |
| \`route\` | Internal service route; paired with \`serviceName\`. |
| \`version\` | Internal API version. |
| \`source\` | Internal request source. |
| \`sourceId\` | Internal source identifier. |
| \`body\` | Internal request body object. Public external option requests remain GET. |

## Dynamic input

An action may contain only one \`DYNAMIC\` input. Its \`field\` and \`fieldType\` are both \`DYNAMIC\`, \`required\` is false, and \`dynamicFieldsConfig\` defines exactly one source.

For public marketplace actions, configure a public HTTPS \`url\` and optional \`headers\`. HighLevel POSTs the current \`data\`, workflow \`extras\`, and action \`meta\` to this endpoint. The response is \`{ "inputs": [{ "section": "Section", "fields": [...] }] }\`. Each returned field uses the same base \`field\`, \`title\`, \`fieldType\`, \`required\`, and \`options\` structure.

| \`dynamicFieldsConfig\` key | Purpose |
| --- | --- |
| \`url\` | Public HTTPS endpoint. Public marketplace dynamic requests are POST. |
| \`headers\` | Request headers with secret references. |
| \`queryParams\` | Optional query parameters. |
| \`body\` | Optional body additions for backend-compatible sources. |
| \`method\` | Backend-compatible HTTP method override: DELETE, GET, PATCH, POST, or PUT. Public portal URL mode uses POST. |
| \`customGenerator\` | Function expression used by backend-owned configurations instead of URL mode. |
| \`serviceName\` | Internal service source, paired with \`route\`. |
| \`route\` | Internal service route, paired with \`serviceName\`. |
| \`version\` | Internal API version. |
| \`source\` | Internal request source. |
| \`sourceId\` | Internal source ID. |
| \`labelField\` | Response property containing a generated field label. |
| \`valueField\` | Response property containing a generated field value. |
| \`path\` | Dot path to the generated-field collection. |
| \`dependsOn\` | Array of input references that affect generated fields. |
| \`postProcessor\` | Backend post-processing function/reference. |

Do not combine \`url\`, \`customGenerator\`, and \`serviceName\`/\`route\` modes.

## Dynamic option source and pagination

\`dynamicSource\` is the backend-compatible resolver required by \`select_with_pagination\` and \`multiselect_with_pagination\`. It supports API or code mode.

| \`dynamicSource\` key | Purpose |
| --- | --- |
| \`executionType\` | \`API\` by default or \`CODE\`. |
| \`code\` | JavaScript body required only for CODE mode. |
| \`url\` | Public HTTPS API URL required in API mode. |
| \`method\` | DELETE, GET, PATCH, POST, or PUT. |
| \`headers\` | API header object with secret references. |
| \`body\` | API request body object. |
| \`labelField\` | Dot path/property for option labels. |
| \`valueField\` | Dot path/property for option values. |
| \`path\` | Dot path to the option array. |
| \`postProcessor\` | Backend response post-processor. |
| \`pagination\` | Pagination and search configuration. |

API and CODE keys are mutually exclusive. CODE must return \`{ options: [{ label, value }] }\`.

| \`pagination\` key | Purpose |
| --- | --- |
| \`enabled\` | Enable pagination. |
| \`strategy\` | \`limit_offset\`, \`page\`, \`last_page\`, \`cursor\`, or \`next_url\`. |
| \`pageParam\` | Page-number request parameter. |
| \`perPageParam\` | Page-size request parameter. |
| \`perPageValue\` | Non-negative page size. |
| \`startingPage\` | Non-negative first page number. |
| \`limitParam\` | Limit request parameter. |
| \`limitValue\` | Non-negative limit value. |
| \`offsetParam\` | Offset request parameter. |
| \`cursorParam\` | Cursor request parameter. |
| \`nextCursorField\` | Response path containing the next cursor. |
| \`syncTokenField\` | Response path containing a sync token. |
| \`syncTokenParam\` | Request parameter carrying the sync token. |
| \`supportsSearch\` | Whether the source accepts search input. |
| \`searchParam\` | Search request parameter. |
| \`fetchAllPages\` | Load every page when the source cannot search. |
| \`order\` | \`asc\` or \`desc\`. |
| \`searchDetail\` | Separate non-paginated \`dynamicSource\` API configuration for search. |
| \`singleDetail\` | Separate non-paginated \`dynamicSource\` API configuration for one selected value. |

## Presentation configuration

\`config\` is field-type specific:

- \`key-value\`: \`maxItems\` (non-negative integer), \`lockDefaultKeys\` (boolean), and \`addItemLabel\`.
- \`fieldSet\`: required \`innerFields\` array plus \`addItemLabel\`, \`itemLabel\`, \`minSets\`, and \`maxSets\`. Minimum cannot exceed maximum.
- Other supported fields: \`richTextEditorType\` is \`html\` or \`plain-text\`.

\`fieldOptions\` supports \`allowedFileTypes\` as a string array and boolean \`showTextFiles\`, \`showUrlFiles\`, and \`isClearable\` values.

\`variantConfig\` is valid only with \`variant: "tile-picker"\` and supports \`columns\` from 2 through 5, \`allowDeselect\`, \`tileSize\` of \`sm\`, \`md\`, or \`lg\`, and \`showDescription\`.

## Validation rules

Each \`validations\` item contains exactly:

| Key | Purpose |
| --- | --- |
| \`rule\` | Predefined rule, regular-expression source, or arrow-function expression. |
| \`errorMessage\` | Required message displayed when the value fails. |

Predefined values are \`isValidEmail\`, \`isValidPhone\`, \`isValidURL\`, \`isValidNumeric\`, and \`isValidHandleBar\`. Regex rules are limited to 1,000 printable ASCII characters and must be deterministic, without ambiguous backtracking. Regex and function rules are parsed and analyzed locally without compilation or execution. Arrow functions receive the field value and return true or false.

## Response data and custom variables

\`customVarsJson\` is a representative JSON object returned by the action. Use realistic primitives and non-empty arrays. Nested objects organize values but cannot themselves be selected. Empty arrays cannot establish an array type.

Each \`customVars\` item supports:

| Key | Purpose |
| --- | --- |
| \`name\` | Required label shown in later workflow steps. |
| \`reference\` | Required unique dot path into \`customVarsJson\`, without whitespace. |
| \`fieldType\` | \`string\`, \`boolean\`, \`numerical\`, \`date\`, or \`array\`. Date references use a JSON string sample. |
| \`options\` | Optional static option metadata using the standard option keys. |
| \`fetchOptions\` | Optional dynamic option configuration using the standard fetch keys. |

Every reference is resolved locally and its type must match the sample. Arrays are exposed to array functions, custom code, and custom webhooks.

## API execution

\`executionConfig.type: "API"\` supports:

| Key | Purpose |
| --- | --- |
| \`type\` | Required value \`API\`. |
| \`url\` | Public HTTP or HTTPS action endpoint; required for review. HTTPS is strongly recommended. |
| \`method\` | DELETE, GET, PATCH, POST, or PUT; required when URL is set. |
| \`headers\` | Header-name-to-value object. Sensitive values use secret references. |
| \`pauseExecution\` | Hold the contact until the workflow resume webhook is called. |

API execution cannot contain \`code\` or \`codeFile\`.

The default execution payload contains configured \`data\`, workflow/location/contact \`extras\`, and action \`meta\` with key and version. When branches are enabled, \`data.branches\` contains the configured branch IDs, names, and field values.

## Code execution

\`executionConfig.type: "CODE"\` stores JavaScript in a separate source file:

\`\`\`json
{
  "executionConfig": {
    "type": "CODE",
    "codeFile": "code/calculate_score.1.1.js",
    "pauseExecution": false
  }
}
\`\`\`

The local-only \`codeFile\` path must be exactly \`code/<action-key>.<major>.<minor>.js\`. The CLI compiles this file for syntax validation without executing it and rejects inline \`code\` in local JSON. The source is the async-function body accepted by the portal editor: top-level \`await\` and \`return\` are valid, and another function wrapper is not.

The runtime provides:

- \`inputData.data.<field>\` for configured input values and \`inputData.data.branches\` when branching is enabled.
- \`inputData.extras.locationId\`, \`workflowId\`, and \`contactId\`; paused execution also provides step/status identifiers.
- \`inputData.headers\`, \`inputData.queryParams\`, and \`inputData.fields\` for resolved external authentication. The current portal picker labels query parameters as URL Params, but the runtime property is \`queryParams\`.
- \`customRequest.get\`, \`post\`, \`put\`, \`patch\`, \`delete\`, \`head\`, and \`options\` for outbound HTTP calls.

Code must return a JavaScript object or array. A synchronous branching action returns an object containing \`branchId\`.

\`\`\`js
const response = await customRequest.post('https://api.example.com/sync', {
  data: {
    contactId: inputData.extras.contactId,
    payload: inputData.data
  }
})

return { status: response.status, result: response.data }
\`\`\`

Code is limited to 1 MiB of UTF-8 text. Symlinks, path traversal, inline JSON \`code\`, duplicate code references, and unreferenced JavaScript files are rejected. Pull extracts remote inline code to \`codeFile\`; push sends the source inline and never sends the path.

API and CODE configuration are mutually exclusive. CODE cannot contain \`url\`, \`method\`, or saved \`headers\`.

## Test an action

Testing code is mandatory in the portal before relying on its output. The CLI exposes the same runner:

\`\`\`bash
ghl app actions test calculate_score --input '{"score":42}'
ghl app actions test calculate_score --input-file ./test-input.json
ghl app actions test calculate_score --input-file ./test-input.json --location LOCATION_ID
\`\`\`

- The action argument is a local key or \`templateId\`; \`--version\` selects a specific version.
- \`--input\` and \`--input-file\` are mutually exclusive and must contain a JSON object keyed by input \`field\`.
- The CLI injects predefined branches as the reserved \`inputData.data.branches\` value so branch-selection code receives production-equivalent metadata.
- \`--location\` is optional. Provide an installed location ID when code/API execution needs location context or external-auth values.
- The command validates local JSON and JavaScript first, resolves \`\${remote}\` and \`\${env:NAME}\` headers, then calls the portal \`/run-code-test\` endpoint.
- API tests call the configured external endpoint and can have real side effects. Use a dedicated test URL and test credentials.
- A failed runner response exits non-zero. CODE output must be an object or array; successful output and console logs are printed, or returned structurally with \`--json\`.

The test result is not silently written to \`customVarsJson\`. Review the output and update the sample response deliberately so existing custom-variable references are not destroyed. For API tests, the response-data sample corresponds to \`output.data\`; status and response headers belong to the test envelope, not the action's custom variables.

## Payload customization

\`payloadCustomizationType: "default"\` requires an empty \`customizedPayload\`. \`payloadCustomizationType: "custom"\` is available only for API execution and requires a non-empty \`customizedPayload\` object.

The portal starts custom payloads with:

\`\`\`json
{
  "data": { "email": "{{action.data.email}}" },
  "extras": {
    "locationId": "{{action.extras.locationId}}",
    "workflowId": "{{action.extras.workflowId}}",
    "companyId": "{{action.extras.companyId}}"
  },
  "meta": {
    "key": "{{action.meta.key}}",
    "version": "{{action.meta.version}}"
  }
}
\`\`\`

Custom payload JSON is application data. Nested properties named \`headers\` are not treated as credential containers.

## Pause and resume

\`pauseExecution: true\` holds the contact at the action. The execution handler must call the resume webhook with the provided step, status, location, and workflow context. When branching asynchronously, the resume request includes the selected branch ID.

With pause disabled, a synchronous API response or code return value chooses a branch through top-level \`branchId\`.

## Branch configuration

An empty \`branchesConfig\` disables branching. A configured object supports:

| Key | Purpose |
| --- | --- |
| \`allowMultipath\` | Allow more than one branch path in backend-compatible configurations. |
| \`altersDynamicField\` | Recompute branch configuration when dependent values change. |
| \`info\` | Customer-visible branch section labels and behavior. |
| \`fields\` | Field definitions used to configure predefined branches. |
| \`predefinedBranches\` | Static or backend-resolved branch paths. |
| \`branchFieldsGenerator\` | Function expression generating branch fields in backend-owned configurations. |

### Branch information

| \`info\` key | Purpose |
| --- | --- |
| \`sectionTitle\` | Branch section title. |
| \`sectionDescription\` | Branch section help copy. |
| \`branchNameLabel\` | Label for a branch name. |
| \`branchNameHelpText\` | Help text for a branch name. |
| \`branchNamePlaceholder\` | Empty-state branch-name text. |
| \`deleteAlertTitle\` | Delete confirmation title. |
| \`deleteAlertDescription\` | Delete confirmation explanation. |
| \`addButtonLabel\` | Add-branch button label. |
| \`allowNewCondition\` | Let workflow users add branches. |
| \`isDefaultBranchEditable\` | Let workflow users edit predefined branches. |
| \`showBranchSection\` | Display or hide the branch section. |

### Branch fields

Each item in \`branchesConfig.fields\` supports \`field\`, \`title\`, \`required\`, \`fieldType\`, \`options\`, \`mappedTo\`, \`altersDynamicField\`, \`disabled\`, \`placeholder\`, \`helpText\`, \`value\`, and \`sortOptions\`.

Branch \`fieldType\` supports \`string\`, \`textarea\`, \`phone\`, \`numerical\`, \`toggle\`, \`select\`, \`multiselect\`, and backend-compatible \`dynamic\`. Select and multiselect branch fields require non-empty static \`options\`.

### Predefined branches

\`predefinedBranches\` supports:

| Key | Purpose |
| --- | --- |
| \`branches\` | Static branch array used by the public portal. |
| \`fetchBranches\` | Backend internal source with required \`serviceName\` and \`route\`, plus optional \`version\`, \`source\`, \`sourceId\`, \`body\`, and \`headers\`. |
| \`customGenerator\` | Function expression generating branches in backend-owned configurations. |

Each static branch supports:

| Key | Purpose |
| --- | --- |
| \`id\` | Required unique branch identifier. Use a UUID generated once and never change it after workflows reference the branch. |
| \`branchName\` | Required customer-visible path name. |
| \`conditionType\` | Required \`default\` or \`user-defined\`. |
| \`fields\` | Values keyed by configured branch field. Required values and field types are checked locally. |
| \`meta\` | Optional branch metadata object. |

A returned/resumed \`branchId\` must exactly match one configured \`id\`.

## Sections and groups

\`sectionOrder\` is a duplicate-free string array controlling input layout. \`groupConfigs\` is keyed by group name; each group supports \`dividerPosition\` with \`none\`, \`above\`, or \`below\`.

Inputs join a group using \`group\`; \`groupDivider\` requests an input-level divider.

## Secret references

Never commit credentials. Header values use:

- \`\${env:VARIABLE_NAME}\`: resolve a new value from the process environment during push or test.
- \`\${remote}\`: preserve the current portal value after pull. It is invalid on a new action because no remote secret exists.

Credential-like header names such as Authorization and API-key headers must use one of these references. Standard content negotiation headers can remain literal. Secret values are hydrated only in memory and are never written back to generated JSON.

## Validation and synchronization

The portal is the remote source of truth. \`.ghl/workflow-actions-state.json\` stores the last-pull baseline for three-way diffing and must not be edited.

- \`ghl app actions create "Name" --key stable_key\` adds a local \`1.0\` draft file.
- \`ghl app actions pull\` replaces generated action JSON/code with portal state and regenerates this guide.
- \`ghl app actions validate\` validates every file, JavaScript source, and the app's \`workflows.readonly\` scope without authentication or API calls.
- \`ghl app actions validate --publishable --action stable_key --version 1.0\` adds review requirements.
- \`ghl app actions test stable_key --input-file ./test-input.json\` executes one local configuration through the portal test runner.
- \`ghl app actions diff\` reports local changes, remote changes, conflicts, and minimal API operations.
- \`ghl app actions push --dry-run\` validates and previews the plan without mutation.
- \`ghl app actions push\` validates again and calls APIs only for changed actions/versions.
- \`ghl app actions new-version stable_key\` creates one server-assigned draft from the latest published version.
- \`ghl app actions publish stable_key --notes "Change log" --force\` submits the pushed draft for review/publication.
- \`ghl app actions delete stable_key\` stages deletion; \`ghl app actions push --force\` applies it permanently. Deleted actions cannot be restored, and existing workflows skip their execution.
- \`ghl app actions\` lists remote action IDs, names, versions, and statuses.

Push validates all files before any action mutation. It then syncs each planned action independently and reports total, succeeded, and failed operations. Successful actions are verified against fresh portal state; failed actions remain pending locally.

Run commands anywhere inside the app folder. The enclosing \`ghl-app.json\` selects that app automatically. Outside a workspace, remote-only commands use the app selected by \`ghl app use\` unless \`--app\` overrides it.
`
}
