export const COMMAND_REFERENCE_START = '<!-- ghl-cli-command-reference:start -->'
export const COMMAND_REFERENCE_END = '<!-- ghl-cli-command-reference:end -->'

interface CommandEntry {
  command: string
  description: string
}

interface CommandGroup {
  title: string
  commands: CommandEntry[]
}

const COMMAND_GROUPS: CommandGroup[] = [
  {
    title: 'Authentication',
    commands: [
      {
        command: 'ghl login',
        description:
          'Authenticate through browser-based PKCE and persist the account selected during authorization. If no account is returned, the first account-aware request selects the developer owner account. Use `--no-browser` to print the approval URL and `--profile <name>` for an isolated login identity.'
      },
      {
        command: 'ghl account',
        description:
          'List every developer account available to the active login, mark the active account, and emit machine-readable results with `--json`.'
      },
      {
        command: 'ghl account switch [accountId]',
        description:
          'Switch the active developer account without logging in again. Omit the ID to show the current account and open a picker with its entry marked active; automation must provide the ID. Switching clears the previous account app selection but does not rebind existing app folders.'
      },
      {
        command: 'ghl logout',
        description:
          'Remove stored login tokens and the selected app for the active profile. The one-time secret ledger is deliberately preserved.'
      }
    ]
  },
  {
    title: 'App workspaces and selection',
    commands: [
      {
        command: 'ghl app list',
        description:
          'List developer apps. Supports `--search <text>`, `--limit <n>`, `--skip <n>`, and `--json` for pagination and automation.'
      },
      {
        command: 'ghl app create',
        description:
          'Create an app in the portal, generate its local workspace, and select it. Automation must provide `--name`, `--type public|private`, `--target sub-account|agency`, and `--listing white-label|standard`; sub-account apps also require `--installer everyone|agency-only`. Use `--directory` and `--folder` to control the local destination.'
      },
      {
        command: 'ghl app pull [appId]',
        description:
          'Refresh generated JSON from the portal. Inside a workspace, app and version IDs come from `ghl-app.json` and no folder prompt is shown. Outside a workspace, provide or select an app and optionally use `--version`, `--directory`, or `--folder`. Pull replaces generated JSON with portal values.'
      },
      {
        command: 'ghl app validate',
        description:
          'Validate local manifests without authentication or API calls. Use `--directory <app-folder>` for another workspace. `--json-schema` prints the app schema and exits; add `--schema <config>` to select the webhook, workflow action, workflow trigger, subscription, or usage-based schema. `--remote` runs the separate server publish-readiness validation and accepts `--app <appId>`.'
      },
      {
        command: 'ghl app diff',
        description:
          'Compare local files, the last-pull baseline, and the current portal version without changing anything. Reports local changes, portal changes, conflicts, and the exact API sections a push would call. Supports `--directory` and `--json`.'
      },
      {
        command: 'ghl app push',
        description:
          'Run local validation, perform a three-way merge, and update only API sections owning local changes. Same-field conflicts stop the push; unrelated portal changes are preserved. Use `--dry-run` to validate and preview the plan, plus `--directory` or `--json` as needed.'
      },
      {
        command: 'ghl app use [appId]',
        description:
          'Select an app and version for commands that operate on stored context. Without an ID, an interactive terminal shows an app picker.'
      },
      {
        command: 'ghl app current',
        description:
          'Show the enclosing workspace app when run inside an app folder; otherwise show the app selected for the active profile.'
      },
      {
        command: 'ghl app info',
        description:
          'Show full information and publish readiness for the selected app. Use `--app <appId>` to override selection and `--json` for structured output.'
      }
    ]
  },
  {
    title: 'Listing and marketplace profiles',
    commands: [
      {
        command: 'ghl app basic-info',
        description:
          'Edit name, tagline, company, contact, website, category, subcategories, business niches, and logo URL. The CLI enforces portal length, URL, category, niche, and white-label rules before mutation.'
      },
      {
        command: 'ghl app listing',
        description:
          'Configure public/private visibility, target users, installer behavior, white-label listing mode, and search keywords. Conditional target and installer combinations are validated locally.'
      },
      {
        command: 'ghl app profiles',
        description:
          'Edit agency and optional sub-account marketplace profiles, including descriptions, preview images, and videos. Enabling a sub-account profile requires its description and at least three screenshots.'
      },
      {
        command: 'ghl app support',
        description:
          'Edit support email, phone, website, documentation, terms, privacy policy, and template-app supported services. At least one support contact is required for publish readiness.'
      },
      {
        command: 'ghl app review-details',
        description:
          'Edit end-to-end and scope demo URLs, review notes, private-app reason, and review test credentials. Credentials are sent to the API but never exported into app JSON.'
      },
      {
        command: 'ghl app media upload <files...>',
        description:
          'Upload and attach a logo with `--logo` or screenshots with `--profile agency|sub-account`. Validates file type, size, image dimensions, aspect ratio, count limits, and profile requirements before upload.'
      },
      {
        command: 'ghl app media delete <urls...>',
        description:
          'Detach and delete app media. Interactive use asks for confirmation; automation must pass `--force`.'
      }
    ]
  },
  {
    title: 'OAuth scopes, redirects, and client keys',
    commands: [
      {
        command: 'ghl app scopes',
        description: 'Show OAuth scopes configured on the selected app version. Supports `--json`.'
      },
      {
        command: 'ghl app scopes add [scopes...]',
        description:
          'Add scopes after validating them against the live scope catalog and app target. The first OAuth save also requires a redirect URI. Sensitive scopes require confirmation or `--force` in automation.'
      },
      {
        command: 'ghl app scopes remove [scopes...]',
        description:
          'Remove scopes. Webhook subscriptions no longer allowed by the remaining scopes are removed in the same update after confirmation; automation uses `--force`.'
      },
      {
        command: 'ghl app redirect',
        description: 'List OAuth redirect URIs and identify the default redirect. Supports `--json`.'
      },
      {
        command: 'ghl app redirect add [urls...]',
        description:
          'Add redirect URIs after URL and white-label validation. Interactive use prompts when URLs are omitted.'
      },
      {
        command: 'ghl app redirect remove [urls...]',
        description: 'Remove redirect URIs using explicit values or the interactive picker.'
      },
      {
        command: 'ghl app redirect default [url]',
        description:
          'Set the default redirect URI. The URI must already exist, and the app version must be live, deprecating, or deprecated.'
      },
      {
        command: 'ghl app keys',
        description: 'List non-secret client-key metadata for the selected app. Supports `--json`.'
      },
      {
        command: 'ghl app keys create [name]',
        description:
          'Create a client ID and one-time client secret. By default it is masked and retained for one later reveal; `--reveal` prints it now without retaining a local copy.'
      },
      {
        command: 'ghl app keys delete [keyId]',
        description:
          'Delete a client key and remove its ledger entry. Interactive use confirms; automation requires `--force`.'
      },
      {
        command: 'ghl app keys default [keyId]',
        description: 'Set an existing client key as the app default using an ID or interactive picker.'
      },
      {
        command: 'ghl app sso-key',
        description:
          'Generate or rotate the one-time SSO key. Rotation is destructive and confirmed; `--reveal` prints the replacement once without retaining a local copy.'
      }
    ]
  },
  {
    title: 'Webhooks',
    commands: [
      {
        command: 'ghl app webhook',
        description: 'Show the webhook URL and current subscriptions for the selected app version. Supports `--json`.'
      },
      {
        command: 'ghl app webhook url [url]',
        description:
          'Set a public HTTPS webhook URL from the local app workspace. The command writes JSON first, validates, synchronizes the remote setting, verifies it, and advances the baseline.'
      },
      {
        command: 'ghl app webhook events',
        description: 'List webhook events currently unlocked by the app OAuth scopes using the live event catalog.'
      },
      {
        command: 'ghl app webhook subscribe [events...]',
        description:
          'Subscribe to scope-compatible events from the local app workspace. `--url` sets a per-event override; the command writes JSON first and synchronizes only webhook settings.'
      },
      {
        command: 'ghl app webhook unsubscribe [events...]',
        description:
          'Remove event subscriptions from the local app workspace using explicit names or the current-subscription picker, then verify and synchronize JSON and the baseline.'
      }
    ]
  },
  {
    title: 'Workflow actions',
    commands: [
      {
        command: 'ghl app actions',
        description:
          'List workflow actions registered for the current workspace or selected app. Supports `--app`, `--directory`, and `--json`.'
      },
      {
        command: 'ghl app actions pull',
        description:
          'Refresh one JSON file per action, extract code execution into versioned files under `actions/code/`, regenerate the action guide, and reset the workflow-action conflict baseline.'
      },
      {
        command: 'ghl app actions create [name]',
        description:
          'Add a version 1.0 draft as a separate local action file. Use `--key <stable_key>` in automation; the corresponding filename uses hyphens and no remote action is created until push.'
      },
      {
        command: 'ghl app actions validate',
        description:
          'Compile referenced JavaScript without executing it, then validate the required app scope, action metadata, inputs, options, response variables, execution, payload, branching, versions, URLs, and secret references locally. Add `--publishable`, optionally with `--action` and `--version`, for release requirements.'
      },
      {
        command: 'ghl app actions test [key]',
        description:
          'Execute one local action version through the portal test runner with `--input` or `--input-file`. Use `--location` for installed-location context. API actions call their configured endpoint and may cause real side effects.'
      },
      {
        command: 'ghl app actions diff',
        description:
          'Perform a three-way comparison using local JSON, the last action pull, and current portal actions. Reports field conflicts and the minimal create/update/delete operation plan.'
      },
      {
        command: 'ghl app actions push',
        description:
          'Validate every action file, merge, and push each changed action independently. Reports total, succeeded, and failed operations; failed actions remain pending for retry. Use `--dry-run` to preview, and `--force` for deletions.'
      },
      {
        command: 'ghl app actions delete [key]',
        description:
          'Stage an action deletion in local JSON. It is applied remotely by `ghl app actions push --force`; interactive use confirms the local removal and automation can use `--json`.'
      },
      {
        command: 'ghl app actions new-version [key]',
        description:
          'Create a server-assigned draft version from a published action, then refresh local JSON. Only one draft version may exist per action.'
      },
      {
        command: 'ghl app actions publish [key]',
        description:
          'Validate and publish an action draft. Requires a change log; automation must pass `--notes` and `--force`. Local changes must be pushed first; re-running repairs an incomplete workflow/registry publication.'
      }
    ]
  },
  {
    title: 'Workflow triggers',
    commands: [
      {
        command: 'ghl app triggers',
        description:
          'List workflow triggers for the current workspace or selected app. Supports `--app`, `--directory`, and `--json`.'
      },
      {
        command: 'ghl app triggers pull',
        description:
          'Refresh one JSON file per trigger, regenerate the trigger guide, and reset the trigger conflict baseline.'
      },
      {
        command: 'ghl app triggers create [name]',
        description:
          'Add a local version 1.0 draft. Automation passes `--key <stable_key>`; push creates the remote trigger.'
      },
      {
        command: 'ghl app triggers validate',
        description:
          'Validate information, sample data, filters, option sources, custom variables, callbacks, app prerequisites, URLs, versions, and header references locally. Add `--publishable`, optionally with `--trigger` and `--version`, for release requirements.'
      },
      {
        command: 'ghl app triggers diff',
        description:
          'Perform a three-way comparison and show portal conflicts plus the minimal create, update, and delete API plan.'
      },
      {
        command: 'ghl app triggers push',
        description:
          'Validate every trigger, then push each changed trigger independently. Reports succeeded and failed counts; use `--dry-run` to preview and `--force` for deletions.'
      },
      {
        command: 'ghl app triggers delete [key]',
        description:
          'Stage deletion by removing the local trigger file. Apply the permanent remote deletion with `ghl app triggers push --force`.'
      },
      {
        command: 'ghl app triggers new-version [key]',
        description: 'Create a server-assigned draft from a published trigger and refresh the local files.'
      },
      {
        command: 'ghl app triggers publish [key]',
        description:
          'Validate and publish a trigger draft. Automation requires `--notes` and `--force`; local changes must be pushed first.'
      }
    ]
  },
  {
    title: 'Billing and pricing',
    commands: [
      {
        command: 'ghl app billing',
        description:
          'Show app-level subscription plans and usage meters. Resolves the app from the current workspace before stored selection and supports `--json`.'
      },
      {
        command: 'ghl app billing pull',
        description:
          'Refresh `src/billing/subscription.json` and `usage-based.json` plus the private conflict baseline. Empty source files and directories are omitted.'
      },
      {
        command: 'ghl app billing validate',
        description:
          'Validate plan caps, immutable fields, prices, durations, app/version restrictions, product references, dynamic-price bounds, directions, and non-overlapping tiers locally.'
      },
      {
        command: 'ghl app billing diff',
        description:
          'Perform a three-way comparison and show portal conflicts plus the exact plan/meter/tier API operations.'
      },
      {
        command: 'ghl app billing push',
        description:
          'Validate, merge, independently push, refetch, verify, and reconcile billing resources. `--dry-run` previews operations; deletions require `--force` in automation.'
      },
      {
        command: 'ghl app billing plan',
        description: 'List subscription plans staged in the current local workspace. Supports `--json`.'
      },
      {
        command: 'ghl app billing plan create [name]',
        description:
          'Stage a free, paid, split-target, monthly, yearly, or life-time plan in `subscription.json`. The remote plan is created only by billing push.'
      },
      {
        command: 'ghl app billing plan delete [plan]',
        description: 'Stage plan deletion by id or exact name. Apply it with `ghl app billing push --force`.'
      },
      {
        command: 'ghl app billing meter',
        description: 'List usage meters staged in the current local workspace. Supports `--json`.'
      },
      {
        command: 'ghl app billing meter create [name]',
        description:
          'Stage conversation-provider, workflow action/trigger, or custom fixed/dynamic usage pricing. Workflow products can be selected from local module JSON.'
      },
      {
        command: 'ghl app billing meter delete [meter]',
        description:
          'Stage meter deletion by meter id or unambiguous product id. Apply it with `ghl app billing push --force`.'
      },
      {
        command: 'ghl app pricing',
        description:
          'Show the legacy pricing summary for the selected app. Prefer `ghl app billing` for JSON-first plans and meters.'
      },
      {
        command: 'ghl app pricing setup',
        description:
          'Set `--model free|paid|freemium`, optional external billing, and free-trial duration. Enforces draft status, template restrictions, conditional URLs, plan transitions, and confirmation for destructive changes.'
      },
      {
        command: 'ghl app pricing add',
        description:
          'Add a free or paid plan with name, amount, interval, location amount, and up to five repeatable features. Validates model compatibility, currency precision, plan limits, user targets, template rules, and white-label text.'
      },
      {
        command: 'ghl app pricing remove [planId]',
        description: 'Remove a pricing plan after confirmation. Automation must pass `--force`.'
      }
    ]
  },
  {
    title: 'Versions and release lifecycle',
    commands: [
      {
        command: 'ghl app versions',
        description: 'List all app versions and their lifecycle statuses. Supports `--json`.'
      },
      {
        command: 'ghl app analyze',
        description:
          'Analyze the draft and return the minimum semantic-version bump; scope changes force a major bump. Supports `--json`.'
      },
      {
        command: 'ghl app draft',
        description:
          'Clone the latest live version into a new draft and select it. Fails when another pending version exists or the app has reached its version limit.'
      },
      {
        command: 'ghl app publish',
        description:
          'Publish a private app or submit a public app for review. Validates readiness, semantic versioning, release notes, active-version limits, and review state. Irreversible automation requires `--force`.'
      },
      {
        command: 'ghl app withdraw',
        description:
          'Withdraw a version from marketplace review back to draft. Interactive use confirms; automation requires `--force`.'
      },
      {
        command: 'ghl app deprecate',
        description:
          'Schedule deprecation of an eligible live version using `--date`, `--reason`, and optional `--timezone`. The date must be at least three days away and version-safety rules are enforced.'
      },
      {
        command: 'ghl app security-review',
        description:
          'Request security review for an eligible private live app after validating install count and readiness. Interactive use confirms; automation requires `--force`.'
      }
    ]
  },
  {
    title: 'Sandbox accounts',
    commands: [
      {
        command: 'ghl sandbox',
        description: 'List sandbox agency accounts and connected apps. Supports `--json`.'
      },
      {
        command: 'ghl sandbox create',
        description:
          'Create the developer sandbox agency using `--name` and a strong `--password`. The password is stored in the local one-time secret ledger.'
      },
      {
        command: 'ghl sandbox delete [companyId]',
        description:
          'Delete a sandbox agency and prune its ledgered password. Interactive use confirms; automation requires `--force`.'
      }
    ]
  },
  {
    title: 'One-time secrets and command discovery',
    commands: [
      {
        command: 'ghl secrets',
        description:
          'List masked one-time secrets for the selected app. Add `--include-account` for account-level sandbox credentials and use `--json` for automation.'
      },
      {
        command: 'ghl secrets reveal',
        description:
          'Print stored secret values once after atomically removing their local copies. Automation requires `--force`; add `--include-account` for sandbox credentials.'
      },
      {
        command: 'ghl help [command]',
        description: 'Show full usage, arguments, flags, examples, and descriptions for a command or topic.'
      },
      {
        command: 'ghl commands',
        description: 'List every installed CLI command. Use `--json` for a machine-readable command inventory.'
      }
    ]
  }
]

function renderCommandGroups(): string {
  return COMMAND_GROUPS.map(group => {
    const commands = group.commands.map(entry => `- \`${entry.command}\` — ${entry.description}`).join('\n')
    return `### ${group.title}\n\n${commands}`
  }).join('\n\n')
}

export function buildManagedCommandReference(): string {
  return `${COMMAND_REFERENCE_START}
## Complete command reference

Every command supports \`--help\`; use it before guessing arguments or flags. Commands that support \`--json\` return structured output for automation. Destructive commands prompt on a terminal and require \`--force\` in non-interactive use.

${renderCommandGroups()}
${COMMAND_REFERENCE_END}`
}

export function buildAppInstructionDocument(fileName: 'AGENTS.md' | 'CLAUDE.md'): string {
  const audience =
    fileName === 'CLAUDE.md'
      ? 'This file provides guidance to Claude Code when working on this GHL marketplace app.'
      : 'This file provides guidance to AI coding agents when working on this GHL marketplace app.'
  return `# ${fileName}

${audience}

## GHL marketplace app workspace

- \`ghl-app.json\` contains app identity, listing, profiles, OAuth metadata, support, billing settings, and review configuration.
- \`src/webhooks/ghl-webhooks.json\` contains configured webhook settings and is omitted when unused.
- \`src/modules/workflows/actions/<action-name>.json\` contains one app-scoped action and all of its versions; its required underscore \`key\` must match the hyphenated filename.
- \`src/modules/workflows/actions/code/<action-key>.<version>.js\` contains one code-backed action version and is referenced through \`executionConfig.codeFile\`.
- \`src/modules/workflows/actions/HIGHLEVEL_WORKFLOW_ACTIONS.md\` documents action fields, naming, validation, and synchronization when actions exist.
- \`src/modules/workflows/triggers/<trigger-name>.json\` contains one app-scoped trigger and all of its versions; its \`key\` must match the hyphenated filename.
- \`src/modules/workflows/triggers/HIGHLEVEL_WORKFLOW_TRIGGERS.md\` documents trigger data, filters, custom variables, callbacks, execution, validation, and synchronization when triggers exist.
- \`src/billing/subscription.json\` contains marketplace subscription plans and is omitted when there are no plans.
- \`src/billing/usage-based.json\` contains app-level usage meters and pricing tiers and is omitted when there are no meters.
- \`src/billing/HIGHLEVEL_BILLING.md\` documents every billing key, conditional rule, immutable field, version restriction, and synchronization step.
- \`.ghl/state.json\` stores the last-pull baseline for conflict detection and must not be edited manually.
- \`.ghl/workflow-actions-state.json\` stores the separate action baseline and must not be edited manually.
- \`.ghl/workflow-triggers-state.json\` stores the separate trigger baseline and must not be edited manually.
- \`.ghl/billing-state.json\` stores app-level plan and meter baselines and must not be edited manually.
- The developer portal and marketplace API are the source of truth.
- Client secrets, SSO keys, review credentials, passwords, and other secret values must never be stored in this workspace.

## Editing and synchronization rules

- Preserve \`schemaVersion\`, \`appId\`, and \`versionId\` unless a GHL CLI command updates them.
- Keep webhook configuration out of \`ghl-app.json\` and out of the workspace root.
- Keep each workflow action in its own JSON file under \`src/modules/workflows/actions/\`; include the matching \`key\` and do not copy actions into \`ghl-app.json\`.
- Keep code execution in the exact versioned file referenced by \`codeFile\`. Do not inline JavaScript in action JSON or point outside the action \`code/\` directory.
- Keep each workflow trigger in its own JSON file under \`src/modules/workflows/triggers/\`; include the filename-derived \`key\` and do not copy triggers into \`ghl-app.json\`.
- Keep JSON valid and retain the documented field names and value types.
- Edit local JSON, run \`ghl app validate\`, inspect \`ghl app diff\`, and then run \`ghl app push\`.
- For workflow actions, use \`ghl app actions validate\`, optionally exercise one with \`ghl app actions test <key>\`, inspect \`ghl app actions diff\`, and then run \`ghl app actions push\`.
- For workflow triggers, use \`ghl app triggers validate\`, inspect \`ghl app triggers diff\`, and then run \`ghl app triggers push\`.
- For plans and usage meters, use \`ghl app billing validate\`, inspect \`ghl app billing diff\`, and then run \`ghl app billing push\`.
- Push validates again, preserves unrelated portal changes, and calls only API sections owning local changes.
- If the same field changed locally and in the portal, pull first and then reapply the intended local edit.
- Run \`ghl app pull\` from this workspace to replace generated JSON with current portal values.
- Never print, invent, or persist credentials in app files, logs, examples, or commits.
- Custom action headers must use \`\${remote}\` to preserve a pulled value or \`\${env:VARIABLE_NAME}\` to inject one during push; standard content-negotiation headers may remain literal.
- Custom trigger headers follow the same secret-reference rules. Never store callback or option-API credentials as literal JSON values.

## Workflow action authoring

- Each action file uses a lowercase, hyphenated filename and contains a required \`key\`. The CLI converts hyphens to underscores, and validation requires the JSON key to match.
- Each action has an API-owned \`templateId\` after its first push and a newest-first \`versions\` array. Read \`src/modules/workflows/actions/HIGHLEVEL_WORKFLOW_ACTIONS.md\` for the complete format.
- Each version may define \`info\`, \`inputs\`, \`customVars\`, \`customVarsJson\`, \`executionConfig\`, payload customization, branches, section order, and group configuration.
- Keep response data in \`customVarsJson\` and map it through \`customVars\`; dot-separated references must resolve to primitive values or non-empty arrays and use the inferred field type.
- An empty \`branchesConfig\` disables branches. Enabled static branches use \`info\`, unique whitespace-free \`fields\`, and \`predefinedBranches.branches\`; every branch needs a unique \`id\`, \`branchName\`, explicit \`conditionType\`, and values matching its field definitions.
- Preserve validated dynamic branch generators and fetch configuration when they are present in pulled API data; fetch configuration requires \`serviceName\` and \`route\`, while UI-equivalent actions should prefer static branches.
- A synchronous branching action selects the next path by returning \`{ "branchId": "<configured-id>" }\` from its API or code execution.
- API execution uses \`url\`, \`method\`, optional \`headers\`, and \`pauseExecution\`; code execution uses a versioned \`codeFile\` and optional \`pauseExecution\`.
- Select inputs require static \`options\`, \`mappedTo\`, \`fetchOptions\`, or \`dynamicSource\`. Paginated selects require \`dynamicSource\`.
- Edit only a \`draft\` version. Treat \`templateId\`, version numbers, and version statuses as server-owned values.

## Workflow trigger authoring

- Each trigger file uses a lowercase, hyphenated filename and contains the matching underscore \`key\`, an API-owned \`templateId\` after creation, and a newest-first \`versions\` array.
- Read \`src/modules/workflows/triggers/HIGHLEVEL_WORKFLOW_TRIGGERS.md\` before editing; it documents every supported key and runtime payload.
- Put representative event data in \`customVarsJson\`. Filter \`field\` and custom-variable \`reference\` paths must resolve in that object and use the matching value type.
- Filter types are \`string\`, \`select\`, \`multiselect\`, and \`DYNAMIC\`. Select filters use exactly one of \`options\`, \`mappedTo\`, or \`fetchOptions\`; only one dynamic filter is allowed.
- \`subscriptionConfig\` receives workflow \`CREATED\`, \`UPDATED\`, and \`DELETED\` events. Store the supplied \`targetUrl\` and POST event data to it to execute the configured workflow.
- Edit only a \`draft\` version. Create versions, publish status, immutable keys, and \`templateId\` through their dedicated CLI commands.

${buildManagedCommandReference()}
`
}
