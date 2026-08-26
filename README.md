# HighLevel Marketplace CLI

`@gohighlevel/marketplace-cli` provides the `ghl` command for the [GoHighLevel marketplace developer portal](https://marketplace.gohighlevel.com). It covers the core developer workflows from the terminal: creating apps, configuring listings, OAuth, webhooks, pricing and media, and publishing to the marketplace.

The CLI is designed to be driven by humans **and** by LLM agents:

- Every interactive prompt has a flag equivalent, so any flow can run non-interactively.
- Read commands support `--json` for machine-readable output.
- Destructive commands ask for confirmation on a terminal and require `--force` in scripts.
- Supported workflows apply the same validation rules as the portal, so bad input fails fast with a fix hint **before** a mutating API call.
- One-time secrets are captured to a local ledger; explicit `--reveal` controls when automation may print generated credentials.

## Requirements

- Node.js 20.12 or newer
- A GoHighLevel developer account ([sign up](https://marketplace.gohighlevel.com))

## Installation

```bash
npm install -g @gohighlevel/marketplace-cli
```

Verify the install and log in:

```bash
ghl --version
ghl login
```

`ghl login` opens the developer portal in your browser (PKCE + loopback callback — the CLI never sees your password). The account selected during browser authorization is bound to the one-time code and stored as the active CLI account. If authorization returns no account, the CLI resolves the developer's owner account on the first account-aware request. The session is stored in `~/.config/ghl/credentials.json` (file mode 0600). Before every API request, the CLI checks `expiresAt` and the JWT `exp` claim and refreshes the session when either is within 60 seconds of expiry. A `401` still triggers one refresh-and-retry for early revocation. Log in again only when the refresh token (7 days) expires.

Use `ghl login --no-browser` to print the approval URL instead of opening a browser, and `--profile <name>` to keep separate login identities. A login can belong to multiple developer accounts; use `ghl account` to list them and `ghl account switch` to change the active account without logging in again.

## Quick start

```bash
ghl login                                 # authenticate via the browser
ghl account                               # list accessible developer accounts
ghl account switch                        # switch account using an interactive picker
ghl app create                            # create the remote app + local JSON folder, then select it
# edit ghl-app.json, webhooks, actions, and triggers under src/modules/workflows/
ghl app validate                          # validate local JSON without an API call
ghl app diff                              # preview local, portal, and conflicting changes
ghl app push                              # update only changed API sections
ghl app actions validate                  # validate every local action and code file
ghl app actions test <key> --input '{}'   # execute a draft configuration through the portal test runner
ghl app actions diff                      # preview workflow-action changes and conflicts
ghl app actions push                      # sync only changed workflow actions
ghl app triggers validate                 # validate every local workflow trigger
ghl app triggers diff                     # preview workflow-trigger changes and conflicts
ghl app triggers push                     # sync only changed workflow triggers
ghl app validate --remote                 # optional server publish-readiness check
ghl app publish                           # go live (private) / submit for review (public)
```

## How interactive mode works

Run any mutating command **without arguments on a terminal** and it prompts for what it needs, prefilled with current values where they exist:

- Long lists (OAuth scopes, webhook events) open a **searchable picker**: type to filter, `space`/`tab` to select, `enter` to confirm.
- **`Esc` cancels any prompt** at any step. The command exits with `Cancelled — nothing was changed.` and no API call is made. `Ctrl+C` behaves the same way.
- The same command run **without a terminal** (scripts, CI, agents) never hangs waiting for input — it exits with a usage-hint error naming the exact flags to pass.

## Configuration

The CLI talks to the GoHighLevel staging environment by default. Override via environment variables:

| Env var | Default | Purpose |
|---|---|---|
| `GHL_PORTAL_URL` | `https://staging.marketplace.gohighlevel.com` | Developer portal (browser login) |
| `GHL_API_URL` | `https://staging.backend.leadconnectorhq.com/marketplace` | Marketplace API |
| `GHL_OAUTH_URL` | `https://staging.backend.leadconnectorhq.com/oauth` | OAuth service (token refresh, scope/webhook catalogs) |
| `GHL_WORKFLOWS_URL` | `https://staging.backend.leadconnectorhq.com/workflows-marketplace` | Workflow action and trigger configuration service |
| `GHL_CONFIG_DIR` | `~/.config/ghl` | Where credentials/config/secrets are stored |

Local state (all files created with mode 0600, written atomically):

| File | Contents |
|---|---|
| `credentials.json` | Sessions per profile (JWT + refresh token) and the active profile |
| `config.json` | The selected app (appId + versionId) per profile |
| `secrets.json` | The one-time secret ledger (see [One-time secrets](#one-time-secrets)) |

## Local app files

`ghl app create` creates the app in the developer portal and a local folder named from the app. For the first pull of an existing app, run `ghl app pull [appId]` outside an app workspace; the CLI creates the same local representation and asks for the parent directory and folder name on an interactive terminal. Automation can pass `--directory <parent>` and `--folder <name>`.

Inside a directory containing `ghl-app.json`, run `ghl app pull` with no app or destination arguments. The CLI reads `appId` and `versionId` from that manifest and refreshes the current workspace directly without asking for a parent directory or folder. An explicit app ID must match the workspace. Passing `--directory` or `--folder` intentionally switches to the new-destination flow.

| File | Contents |
|---|---|
| `ghl-app.json` | App identity/version binding plus listing, profiles, OAuth metadata, support, basic/external billing settings, and review configuration. External authentication, external configuration, MCP configuration, and custom pages are intentionally excluded. |
| `src/webhooks/ghl-webhooks.json` | Webhook URL and event subscriptions, created only when a URL or event is configured. |
| `src/modules/workflows/actions/<action-name>.json` | One app-scoped workflow action per file. A name such as `send-contact-sync-payload.json` requires the JSON key `send_contact_sync_payload`. |
| `src/modules/workflows/actions/code/<action-key>.<version>.js` | JavaScript source for one code-backed action version, referenced by `executionConfig.codeFile` in its action JSON. |
| `src/modules/workflows/actions/HIGHLEVEL_WORKFLOW_ACTIONS.md` | Generated reference created with the actions directory only when the app has an action. |
| `src/modules/workflows/triggers/<trigger-name>.json` | One app-scoped workflow trigger per file. A name such as `contact-status-updated.json` requires the JSON key `contact_status_updated`. |
| `src/modules/workflows/triggers/HIGHLEVEL_WORKFLOW_TRIGGERS.md` | Generated key-by-key reference created with the triggers directory only when the app has a trigger. |
| `src/billing/subscription.json` | App-level marketplace subscription plans, created only when the app has a plan. |
| `src/billing/usage-based.json` | App-level fixed or dynamic usage meters and their price tiers, created only when the app has a meter. |
| `src/billing/HIGHLEVEL_BILLING.md` | Generated key-by-key billing reference created only when billing source configuration exists. |
| `.ghl/state.json` | Sanitized last-pull baseline used for three-way conflict detection. Keep it with the workspace and do not edit it. |
| `.ghl/workflow-actions-state.json` | Sanitized workflow-action baseline used for separate three-way conflict detection. Do not edit it. |
| `.ghl/workflow-triggers-state.json` | Sanitized workflow-trigger baseline used for separate three-way conflict detection. Do not edit it. |
| `.ghl/billing-state.json` | App-level subscription-plan and usage-meter baseline used for separate three-way conflict detection. Do not edit it. |
| `AGENTS.md` | GHL workspace rules and a complete command reference for AI coding agents. |
| `CLAUDE.md` | The same workspace rules and command reference, addressed specifically to Claude Code. |
| `HIGHLEVEL_APP.md` | Structural guide covering workspace files, app configuration sections, exclusions, version binding, and the local synchronization workflow. |

These files contain configuration, not credentials. Client secrets, SSO keys, review test credentials, password defaults, and secret-bearing external-auth values are never exported. Custom workflow action and trigger headers are exported as `${remote}` so a later push preserves the portal value without exposing it; use `${env:VARIABLE_NAME}` to inject a replacement at push time. Standard content-negotiation headers such as `Content-Type` may remain literal. Server-owned analytics, timestamps, install counts, and review workflow state are also excluded. The manifests use schema version `1`, deterministic formatting, atomic writes, and mode 0644; CLI baselines use mode 0600.

The portal is the source of truth. `ghl app diff` performs a three-way comparison between the last pull, local JSON, and the current portal version. `ghl app push` first runs local validation, aborts before authentication when validation fails, rejects same-field conflicts, merges non-overlapping set changes, preserves other portal changes, and calls only the API sections owning local changes. Scope or webhook edits read only the current catalogs required to validate those edits before mutation. Billing resources use the independent `ghl app billing validate`, `diff`, and `push` lifecycle so app-profile and billing APIs are never called unnecessarily. After a successful push the CLI verifies remote fields and refreshes the corresponding manifests and baseline. Use `--dry-run` to see an API plan without changing remote or local state.

Webhook mutation shortcuts follow the same workspace contract: `url`, `subscribe`, and `unsubscribe` require an app folder (or `--directory`), validate the complete change, write `src/webhooks/ghl-webhooks.json` first, update only webhook settings remotely, verify the result, and then advance the baseline. A confirmed API rejection restores the JSON. If a lost response leaves the remote result uncertain, the desired JSON remains as a visible pending change for `ghl app diff` and `ghl app push`; the CLI never hides an unverified mutation by blindly rolling it back.

In schema version 1, app profile/listing fields, OAuth scopes and redirects, webhook configuration, default redirect/client key, review details (excluding credentials), and billing settings are pushable. Subscription plans and usage meters are pushable through their separate billing manifests. Client-key metadata, server-owned identity/status fields, and plan-derived summary fields in `ghl-app.json` remain pull-only.

Pulling into an existing folder is allowed only when its `ghl-app.json` belongs to the same app; developer-created files and customized agent instructions are preserved. Pull replaces local generated JSON with portal values, so run `ghl app diff` first if the workspace may contain unpushed edits. Legacy root-level webhook files generated by an earlier CLI version are safely migrated to `src/webhooks`. Use `--version <versionId|semver>` to pull a version other than the version bound in `ghl-app.json`.

Workflow actions belong to the app rather than a marketplace app version. Each action has its own versions, and only one draft may exist at a time. `ghl app pull` refreshes the action catalog along with app files. Use the dedicated `ghl app actions validate`, `diff`, and `push` commands for action configuration so action APIs remain independent from app-profile APIs.

Workflow triggers are also app-scoped and independently versioned. `ghl app pull` refreshes them into one JSON file per trigger. The dedicated `ghl app triggers validate`, `diff`, and `push` commands enforce the portal's filter, sample-data, custom-variable, callback, OAuth, version, URL, and secret rules before calling trigger APIs.

Subscription plans and usage meters are app-scoped rather than tied to one app version. `ghl app pull` refreshes both resources. Plan mutations are permitted only while the workspace version is draft or disapproved; a live app can create a new draft and manage the shared plans from that draft. Usage meters match the current portal behavior and remain manageable for live apps, but are unavailable for template apps and external-billed apps.

## Core concepts

**Current app.** Commands resolve an app in this order: an explicit `--app <id>`, the nearest enclosing `ghl-app.json`, then the selection stored by `ghl app use` / `ghl app create`. Running anywhere inside an app folder therefore targets that app automatically; outside a workspace, the stored selection applies. Check the resolved app with `ghl app current`.

**Draft-following.** Editing a live version automatically creates a new pending draft on the server. The CLI detects this and updates your selection to the new draft, printing a note — you keep editing the right version without thinking about it.

**Portal-parity validation.** Supported workflows enforce the corresponding portal rules client-side before a mutating API call: version-bump rules on publish, the 3-day minimum deprecation date, pricing model restrictions, scope catalogs, media dimensions, white-label branding checks, and more. Error messages state the rule and how to fix the input.

**Exit codes.** `0` on success or user cancel (Esc), non-zero on any error. Normal errors and spinners print to stderr; JSON-enabled commands return structured JSON errors on stdout with a non-zero exit — check the exit code before consuming output.

## Command reference

### Authentication

| Command | Description |
|---|---|
| `ghl login` | Browser-based login. Flags: `--no-browser` (print URL instead), `--profile <name>` (store under a named profile, default `default`). |
| `ghl account` | List every developer account available to the active login and mark the active account. Supports `--json`. |
| `ghl account switch [accountId]` | Switch the `teamid` used by subsequent API calls without logging in again. Omitting the ID shows the current account and opens a picker with its entry marked active; scripts must provide the ID. The previous account's stored app selection is cleared; existing app folders remain bound to their original apps. |
| `ghl logout` | Delete the stored tokens (`credentials.json`) and app selection (`config.json`). Every API command fails with `Not logged in` until the next `ghl login`. The one-time secret ledger (`secrets.json`) is kept because its values cannot be recovered after deletion — the command prints its path if you want to remove it manually. |

### App selection

| Command | Description |
|---|---|
| `ghl app list` | List apps. Flags: `--search <text>`, `--limit <n>` (default 50), `--skip <n>`, `--json`. |
| `ghl app create` | Create an app in the portal, create its local JSON folder, and select it. Interactive, or provide `--name`, `--type public\|private`, `--target sub-account\|agency`, and `--listing white-label\|standard`; sub-account targets also require `--installer everyone\|agency-only`. Local flags: `--directory <parent>`, `--folder <name>`. |
| `ghl app pull [appId]` | Refresh the current workspace using its `ghl-app.json`, or create a local workspace for an existing app when run elsewhere, then select that version. Flags: `--version <versionId\|semver>`, `--directory <parent>`, `--folder <name>`, `--json`. |
| `ghl app validate` | Validate the local workspace without authentication or API calls. Use `--directory <app-folder>`; `--remote` runs the separate server publish-readiness checklist. |
| `ghl app diff` | Read the current portal version and show local changes, portal-only changes, conflicts, and the minimal API section plan. Flags: `--directory <app-folder>`, `--json`. |
| `ghl app push` | Validate, three-way merge, and push only changed sections; then verify and refresh local state. Flags: `--directory <app-folder>`, `--dry-run`, `--json`. |
| `ghl app use [appId]` | Select the app to work on (interactive picker when omitted). Stores appId **and** versionId. |
| `ghl app current` | Show the enclosing workspace app, or the stored selection when outside an app workspace. |
| `ghl app info` | Full detail view of the selected app, including publish readiness. `--json` for the raw object. |

### Listing & profile

All section editors are interactive with current values prefilled, or fully flag-driven. They save the complete section (merged with current values), exactly like the portal pages.

| Command | Description |
|---|---|
| `ghl app basic-info` | Name, tagline (20–170 chars), company, website, categories (1–3), business niches (up to 3), logo URL. |
| `ghl app listing` | App type (`--type public\|private` converts the app), target user, installer, listing type, search keywords (200 chars total). |
| `ghl app profiles` | Agency description (300–5000 chars plain text) + optional separate sub-account profile with its own description/video. Enabling the sub-account profile requires 3+ screenshots and a description in one save. |
| `ghl app support` | Support email/phone (one required to publish), website, docs, terms, privacy URLs. Template apps also require one or more repeatable `--service` values; use `ghl app support --help` to list them. |
| `ghl app review-details` | Demo video URLs required for public review submission (`--demo`, `--scopes-demo`), test credentials, notes, `--private-reason` for private apps. |

### Media

| Command | Description |
|---|---|
| `ghl app media upload <files...>` | Upload and attach. `--logo` for the logo (exactly one file), `--profile agency\|sub-account` for screenshots. Logo: ≤512 KB, square, 400–800 px. Screenshots: ≤5 MB, 600–1000 px wide, 1.5:1–1.8:1 aspect, max 9 per profile. Reaching 3 sub-account screenshots auto-enables that profile. |
| `ghl app media delete <urls...>` | Detach and delete media. Confirms; `--force` in scripts. |

### OAuth (scopes, redirects, keys)

| Command | Description |
|---|---|
| `ghl app scopes` | Show current scopes. |
| `ghl app scopes add [scopes...]` | Add scopes. No args on a terminal → searchable picker of the scope catalog (filtered to your app's user types). First-ever auth save must include a redirect URI (`--redirect <url>` or prompted). Sensitive scopes (`users.write`, `locations.write`) require confirmation (`--force` in scripts). |
| `ghl app scopes remove [scopes...]` | Remove scopes (picker when omitted). Webhook events unlocked only by removed scopes are unsubscribed in the same save — confirmed first (`--force` in scripts). |
| `ghl app redirect` | Show redirect URIs. |
| `ghl app redirect add [urls...]` | Add redirect URIs (prompted when omitted). HTTP is allowed (local development); white-label-friendly apps cannot use GHL-branded URLs. |
| `ghl app redirect remove [urls...]` | Remove redirect URIs (picker when omitted). |
| `ghl app redirect default [url]` | Mark a URI as default (picker when omitted). Only for live/deprecating/deprecated versions. |
| `ghl app keys` | Show client keys. |
| `ghl app keys create [name]` | Create a client id + secret pair. The secret is returned **once**: output is masked and the value is saved to the local ledger (`--reveal` to print it, including as JSON). |
| `ghl app keys delete [keyId]` | Delete a key (picker when omitted; confirms; `--force` in scripts). Prunes the ledger entry. |
| `ghl app keys default [keyId]` | Mark a key as default (picker when omitted). |
| `ghl app sso-key` | Generate or rotate the SSO key (confirms rotation; masked and ledgered interactively). Scripts must pass `--force --reveal` so the replacement key cannot be lost. |

### Webhooks

| Command | Description |
|---|---|
| `ghl app webhook` | Show webhook configuration. |
| `ghl app webhook url [url]` | Set the app webhook URL from its local workspace (prompted when omitted). Must be public HTTPS. |
| `ghl app webhook events` | List events your current scopes unlock. |
| `ghl app webhook subscribe [events...]` | Update local JSON first, then subscribe to scope-compatible events (searchable picker when omitted). `--url` sets a per-event override URL. |
| `ghl app webhook unsubscribe [events...]` | Update local JSON first, then unsubscribe (picker of current subscriptions when omitted). |

### Workflow actions

Workflow actions use one JSON file per action under `src/modules/workflows/actions/`. Every file contains a required `key`, while its filename independently derives the expected value: lowercase letters, numbers, and hyphens are allowed, and each hyphen becomes an underscore. For example, `send-contact-sync-payload.json` requires `"key": "send_contact_sync_payload"`. A mismatch fails local validation. App-version IDs are intentionally not duplicated into the module model.

Code execution is stored separately as `code/<action-key>.<version>.js`, and the matching version uses `executionConfig.codeFile`. The version suffix prevents draft and published source from overwriting each other. Pull extracts the portal's inline code; validate and push compile the file without executing it, validate the complete action, and then send the contents back as the API's inline `executionConfig.code`. Code files must be UTF-8, at most 1 MiB, canonical for the action key and version, and cannot be symbolic links or unreferenced files.

| Command | Description |
|---|---|
| `ghl app actions` | List remotely registered actions. Resolves the app from the current workspace, `--app`, or the selected app; supports `--json`. |
| `ghl app actions pull` | Refresh all per-action JSON files, extract versioned JavaScript under `actions/code/`, regenerate the action guide, and reset the action conflict baseline. |
| `ghl app actions create [name]` | Add a separate local action file with a version `1.0` draft. Automation passes `--key <stable_key>`; push creates it remotely. |
| `ghl app actions validate` | Compile referenced JavaScript without executing it, then validate every local action and the required `workflows.readonly` app scope without authentication. `--publishable` enforces inputs and API URL/code requirements; optionally target `--action` and `--version`. |
| `ghl app actions test [key]` | Execute one local action version through the portal test runner. Accepts a JSON object through `--input` or `--input-file`; use `--location` when installed-location context is required. API actions call their configured endpoint and may cause real side effects. |
| `ghl app actions diff` | Three-way action comparison with field conflicts and exact create/update/delete API operations; supports `--json`. |
| `ghl app actions push` | Validate all files first, then apply each planned action independently and report total/succeeded/failed counts. Successful actions are verified; failed actions stay pending. `--dry-run` previews, and deletions require `--force` in automation. |
| `ghl app actions delete [key]` | Stage deletion in local JSON. Run `ghl app actions push --force` to apply it remotely; supports `--json`. |
| `ghl app actions new-version [key]` | Create a server-assigned draft from a published action. Refuses when a draft or unpushed local edit already exists. |
| `ghl app actions publish [key]` | Publish a complete draft. Automation must pass `--notes <change-log> --force`; local changes must be pushed first. Re-running repairs an incomplete workflow/registry publication without republishing the workflow version. |

An action version supports the UI fields for information, all portal input types, conditional option sources, dynamic POST-generated fields, response variables/schema, API or code execution, payload customization, pause behavior, branches, section ordering, and group configuration. Select inputs use exactly one of `options`, `mappedTo`, or `fetchOptions`; paginated backend-compatible selects use `dynamicSource`. An action may contain at most one `DYNAMIC` input. Published and in-review versions are immutable; create a new draft before editing them. The generated `HIGHLEVEL_WORKFLOW_ACTIONS.md` is the canonical key-by-key authoring reference.

Response data and custom variables are separate from action `inputs`. Add representative output to `customVarsJson`, then map selectable primitive values or non-empty arrays through `customVars`. References use dot notation and their type must match the sample value:

```json
{
  "customVarsJson": {
    "result": { "status": "delivered", "attempts": 2, "tags": ["priority"] }
  },
  "customVars": [
    { "name": "Status", "reference": "result.status", "fieldType": "string" },
    { "name": "Attempts", "reference": "result.attempts", "fieldType": "numerical" },
    { "name": "Tags", "reference": "result.tags", "fieldType": "array" }
  ]
}
```

An empty `branchesConfig` disables branching. To enable it, define optional UI labels in `info`, unique whitespace-free references in `fields`, and static paths in `predefinedBranches.branches`. Each path needs a unique `id`, `branchName`, `conditionType` (`default` or `user-defined`), and values matching the field definitions. A synchronous action selects the next path by returning `{ "branchId": "<configured-id>" }`.

Pulled actions may also contain advanced dynamic branch generators or fetch configuration. The CLI preserves and validates those API-supported fields; branch fetch configuration requires `serviceName` and `route`. New UI-equivalent actions should use the static branch structure above.

### Workflow triggers

Workflow triggers use one JSON file per trigger under `src/modules/workflows/triggers/`. Filenames are lowercase and hyphenated; every hyphen maps to an underscore in the required immutable `key`. Trigger versions are app-scoped, independently versioned, and editable only while in draft.

| Command | Description |
|---|---|
| `ghl app triggers` | List remote triggers for the current workspace, `--app`, or selected app. |
| `ghl app triggers pull` | Refresh all per-trigger JSON files, regenerate the guide, and reset the trigger conflict baseline. |
| `ghl app triggers create [name]` | Add a local `1.0` draft with `--key <stable_key>`; push creates it remotely. |
| `ghl app triggers validate` | Validate app prerequisites, information, sample data, filter references and option sources, custom variables, callbacks, URLs, secrets, and versions locally. Add `--publishable`, `--trigger`, and optional `--version` for release checks. |
| `ghl app triggers diff` | Three-way comparison with field conflicts and exact create/update/delete operations. |
| `ghl app triggers push` | Validate everything, then push each changed trigger independently. `--dry-run` previews; deletions require `--force` in automation. |
| `ghl app triggers delete [key]` | Stage deletion locally; `ghl app triggers push --force` applies the permanent remote deletion. |
| `ghl app triggers new-version [key]` | Create the next server-assigned draft from a published trigger. |
| `ghl app triggers publish [key]` | Publish after a clean push. Automation requires `--notes <change-log> --force`. |

Put representative event payload data in `customVarsJson`. Filter fields and custom-variable references use dot paths into that data. The UI supports `string`, `select`, `multiselect`, and one `DYNAMIC` filter; select-like fields require exactly one of `options`, `mappedTo`, or `fetchOptions`.

The subscription callback receives workflow trigger `CREATED`, `UPDATED`, and `DELETED` events, including a server-issued `targetUrl`. Store that URL and POST real event data to it to start the configured workflow. The generated `HIGHLEVEL_WORKFLOW_TRIGGERS.md` contains every key, request/response shape, internal reference, callback payload, secret rule, and lifecycle detail.

### Billing and pricing

The billing model, external-billing URL, and trial settings remain under `billing` in `ghl-app.json` and are synchronized with `ghl app push`. External billing follows the portal cutoff and is unavailable for apps created after June 17, 2026. Subscription plans and usage meters have an independent JSON-first lifecycle.

| Command | Description |
|---|---|
| `ghl app billing` | Show remote subscription plans and usage meters for the workspace or selected app. |
| `ghl app billing pull` | Refresh both local billing manifests and the private billing baseline. Empty source files/directories are omitted. |
| `ghl app billing validate` | Validate every plan, meter, tier, conditional field, product reference, version restriction, and immutable field locally. |
| `ghl app billing diff` | Three-way comparison with portal conflicts and the exact plan/meter/tier API operations. |
| `ghl app billing push` | Validate, merge, call only required APIs, verify remote state, and retain failed local intent. Use `--dry-run`; deletions require `--force` in automation. |
| `ghl app billing plan` | List local plans. |
| `ghl app billing plan create [name]` | Stage a plan in `subscription.json`; supports free, split agency/location, monthly, yearly, and life-time pricing. Paid amounts start at USD 0.01. |
| `ghl app billing plan delete [plan]` | Stage plan deletion by id or exact name. |
| `ghl app billing meter` | List local usage meters. |
| `ghl app billing meter create [name]` | Stage fixed/dynamic pricing for conversation providers, workflow actions/triggers, or custom products. |
| `ghl app billing meter delete [meter]` | Stage meter deletion by meter id or unambiguous product id. |

Plans allow up to five features and six total plans (one life-time plan for template apps). After creation, only plan name and features are editable; amounts, duration/type, and free flags are immutable. Meter prices range from 0.000001 through 200 with six-decimal precision. Dynamic pricing is custom-product-only and requires minimum/default/maximum prices plus a public HTTPS pricing page. See generated `src/billing/HIGHLEVEL_BILLING.md` for every JSON key.

Workflow action and trigger meters must reference components already registered in the portal. Pull the matching component state first and push new actions/triggers before staging a meter; billing validation checks its local key and last synchronized remote baseline before creating the meter.

The older `ghl app pricing` commands remain available for compatibility, but new plan workflows should use `ghl app billing` so local JSON and conflict baselines stay authoritative.

### Versions & lifecycle

| Command | Description |
|---|---|
| `ghl app versions` | List all versions and statuses. |
| `ghl app validate --remote` | Server publish-readiness checklist with fix hints. Local `ghl app validate` is documented under app selection. |
| `ghl app analyze` | Analyze the draft and suggest the next version (semver; scope changes force a major bump). |
| `ghl app publish` | Publish the draft. The new version must be a **patch/minor/major bump of the current live version** — interactively you pick from the three computed options (minimum bump comes from the analyze API; major is blocked at 7 active versions). The first publish is always `1.0.0` and needs no release notes. Flags: `--version <x.y.z>`, `--agency-notes`, `--sub-account-notes`, `--force`. Private apps go **live immediately**; public apps are **submitted for review** (requires review details; only one version can be in review at a time). |
| `ghl app draft` | Create and select a draft from the latest live version. Blocked when another pending version exists or the app has reached 8 total versions. |
| `ghl app withdraw` | Pull a version out of marketplace review back to draft (confirms; `--force`). |
| `ghl app deprecate` | Schedule deprecation of a **live** version. Date must be ≥ 3 days from today (`--date YYYY-MM-DD`), `--reason` shown to installed users, `--timezone` defaults to your local timezone. The newest live version cannot be deprecated, and at least one live version must remain (unless it is the app's only version). |
| `ghl app security-review` | Request a security review after four qualifying agency installs (private live apps; validates readiness; confirms; `--force`). |

### Sandbox

| Command | Description |
|---|---|
| `ghl sandbox` | List sandbox agency accounts and connected apps. `--json`. |
| `ghl sandbox create` | Create a sandbox agency (`--name`, `--password` — 12+ chars with upper/lower/number/special). One active sandbox per developer; your developer profile needs a phone number. The password is saved to the ledger. |
| `ghl sandbox delete [companyId]` | Delete a sandbox (picker when omitted; confirms; `--force`). Prunes the ledgered password. |

### Secrets

| Command | Description |
|---|---|
| `ghl secrets` | List one-time secrets captured for the selected app (values masked). Add `--include-account` to include sandbox passwords. |
| `ghl secrets reveal` | Print the actual values. Interactive terminals only — pass `--force` to allow it in scripts; add `--include-account` for sandbox passwords. |

### Discovery

| Command | Description |
|---|---|
| `ghl help [command]` | Help for any command or topic. |
| `ghl commands` | Flat list of every command (`--json` available). |

## One-time secrets

Client secrets, SSO keys, and sandbox passwords **cannot be retrieved from the API after creation**. Commands record them in `~/.config/ghl/secrets.json` (0600) under the active profile so a human can recover the value with `ghl secrets reveal`. If local storage fails, generated values are shown automatically only when both input and output are interactive terminals; automation must opt in with `--reveal`.

- When the ledger write succeeds, creation output shows a masked value (`****last4`); pass `--reveal` when a script legitimately needs it inline. A failed write may reveal a generated value only on a fully interactive terminal, never automatically in redirected or non-interactive output.
- `ghl secrets` is scoped to the selected app — it never shows another app's client secrets. Account-level sandbox passwords appear only with `--include-account` (or when no app is selected).
- Deleting a key or rotating an SSO key prunes the old ledger entry, so the ledger only lists credentials that still work.
- Values created outside this CLI were never captured and can only be replaced by rotating.

## Using the CLI from an LLM agent

The CLI is built to be agent-operable end to end:

1. **Always pass flags** — agents run without a TTY, and every prompt has a flag equivalent. Missing input produces a deterministic error naming the exact flags to pass.
2. **Use `--json`** on read commands (`app list`, `app info`, `app versions`, `app diff`, `sandbox`, `app analyze`, `commands`) and parse stdout; progress spinners go to stderr.
3. **Pass `--force`** on destructive or irreversible actions (delete, publish, deprecate, withdraw…) — without it, non-TTY runs refuse rather than guess.
4. **Trust the errors** — validation runs before the API call and error messages contain the rule and the fix (e.g. which scopes are unknown, which checklist fields are missing, which versions are allowed).
5. **Secrets stay recoverable** — one-time values are masked in output but saved locally, so the human can retrieve them later with `ghl secrets reveal`.

## Local development

```bash
git clone https://github.com/GoHighLevel/ghl-cli.git
cd ghl-cli
npm install
npm run build
npm link          # makes `ghl` available globally, pointing at your build
npm test          # build, then run unit and public-command contract tests
```

A local build talks to the GoHighLevel staging environment by default — no configuration needed. To target a different environment, override the URLs listed in [Configuration](#configuration).

### Source layout

Command entry points follow the public CLI hierarchy under `src/commands`. Reusable modules are grouped by responsibility under `src/lib`: `api`, `app`, `auth`, `billing`, `config`, `secrets`, `shared`, `webhooks`, and `workflows` (with separate `actions`, `triggers`, and shared workflow code). Unit tests mirror the same domains under `tests/lib`, so an implementation and its tests are easy to locate together.

### Releasing

`npm publish` runs `prepack` automatically: it compiles TypeScript and generates `oclif.manifest.json` (which makes `ghl help` fast by avoiding command discovery at runtime).

```bash
npm version patch   # or minor / major
npm publish
```

## License

[MIT](LICENSE)
