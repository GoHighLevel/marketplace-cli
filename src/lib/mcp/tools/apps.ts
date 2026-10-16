import { promises as fs } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { persistSelection } from '../../app/context.js'
import { APP_NAME_MAX_LENGTH, buildCreateAppBody, validateAppName } from '../../app/create.js'
import { loadAppOverview } from '../../app/overview.js'
import { readPullWorkspaceBinding, type PullWorkspaceBinding } from '../../app/pull.js'
import { checkWorkspace } from '../../app/workspace-check.js'
import { initializeCreatedApp } from '../../app/workspace-create.js'
import {
  APP_MANIFEST_FILENAME,
  assertAppDirectoryAvailable,
  resolveAppDirectory,
  slugifyAppName,
  validateAppFolderName
} from '../../app/workspace.js'
import {
  loadPullSnapshot,
  preparePullDestination,
  pulledSelection,
  type PullSnapshot,
  writePulledWorkspace
} from '../../app/workspace-pull.js'
import { type ScopeReference, scopeReferences } from '../../auth/settings.js'
import type { CliConfig } from '../../config/environment.js'
import { absolutePath, appId } from '../inputs.js'
import { CodedError, errorMessage } from '../../shared/errors.js'
import { portalClient } from '../portal.js'
import { oneLine } from '../text.js'
import { defineTool, textResult, type Toolset } from '../tool.js'
import { appOverviewText, versionLabel } from './app-overview.js'

const READ_ONLY_PORTAL = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const
const TARGET_USER_TYPES: Readonly<Record<'sub-account' | 'agency', string[]>> = {
  'sub-account': ['Location'],
  agency: ['Company']
}
const TOKEN_TYPE_NAMES: Readonly<Record<string, string>> = { Location: 'sub-account', Company: 'agency' }
const SCOPES_NEXT_STEP =
  'Request scopes in ghl-app.json (oauth.allowedScopes) and subscribe to events in src/webhooks/ghl-webhooks.json.'

const appInput = {
  appId: appId()
    .optional()
    .describe('App id from get-account. Defaults to the app of directory, then the selected app.'),
  directory: absolutePath().optional().describe('Absolute path inside an app workspace, used when appId is omitted.')
}

const folderName = () =>
  z
    .string()
    .trim()
    .refine(folder => validateAppFolderName(folder) === true, 'Use one folder name without path separators.')

const createInput = {
  name: z
    .string()
    .trim()
    .max(APP_NAME_MAX_LENGTH)
    .refine(name => validateAppName(name) === true, 'The app name is required.')
    .describe('App name, at most 50 characters.'),
  type: z.enum(['public', 'private']).describe('public: listed in the marketplace; private: installed by link.'),
  target: z.enum(['sub-account', 'agency']).describe('Who uses the app.'),
  installer: z
    .enum(['everyone', 'agency-only'])
    .optional()
    .describe('Required for sub-account apps: who may install it.'),
  listing: z.enum(['white-label', 'standard']).describe('white-label: agencies may rebrand it.'),
  directory: absolutePath().describe('Existing folder to create the workspace folder in.'),
  folder: folderName().optional().describe('Workspace folder name; defaults to the app name.')
}

const pullInput = {
  appId: appId().optional().describe('App to pull, from get-account. Omit to refresh the workspace at directory.'),
  directory: absolutePath().describe('An app workspace to refresh, or the folder to create a new workspace in.'),
  folder: folderName().optional().describe('New workspace folder name; defaults to the app name.'),
  version: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .optional()
    .describe('Version id or number from get-app; defaults to the latest version, the draft if one exists.'),
  force: z.boolean().default(false).describe('Discard unpushed local changes when refreshing a workspace.'),
  withTypes: z
    .boolean()
    .default(false)
    .describe('Also write TypeScript declarations and tsconfig for TypeScript actions.')
}

const scopesInput = {
  query: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      'Any of these words in a scope, label, or webhook event, e.g. "contacts" or "ContactCreate". Omit for all.'
    ),
  target: z.enum(['sub-account', 'agency']).optional().describe('Only scopes an app with this target can request.')
}

function scopeLine(reference: ScopeReference): string {
  const tokens = (reference.tokenType ?? [])
    .map(type => (Object.hasOwn(TOKEN_TYPE_NAMES, type) ? TOKEN_TYPE_NAMES[type] : oneLine(type, 40)))
    .join(', ')
  const events =
    reference.events.length > 0 ? ` Events: ${reference.events.map(event => oneLine(event, 80)).join(', ')}.` : ''
  const description = oneLine(reference.description ?? reference.label, 300)
  return `${oneLine(reference.scope, 100)}${tokens ? ` (${tokens})` : ''}: ${description}${events}`
}

interface ScopeFilter {
  query?: string
  target?: keyof typeof TARGET_USER_TYPES
}

function scopesText(references: readonly ScopeReference[], filter: ScopeFilter): string {
  const scope = [filter.query && `matching "${filter.query}"`, filter.target && `for ${filter.target} apps`]
    .filter(Boolean)
    .join(' ')
  if (references.length === 0) return `No scopes ${scope}. Call list-scopes without filters to see every scope.`
  return [
    `${references.length} scope(s)${scope ? ` ${scope}` : ''}:`,
    ...references.map(scopeLine),
    '',
    SCOPES_NEXT_STEP
  ].join('\n')
}

/* A refresh overwrites the workspace, so unpushed edits are named and kept
   unless the caller explicitly discards them. */
async function assertNothingUnpushed(binding: PullWorkspaceBinding): Promise<void> {
  const pending = (await checkWorkspace(binding)).modules.filter(
    module => module.localChanges.length > 0 || module.errors.length > 0
  )
  if (pending.length === 0) return
  const details = pending.map(
    module => `${module.name}: ${module.localChanges.join(', ') || 'edits that fail validation'}`
  )
  throw new CodedError(
    'LOCAL_CHANGES',
    `Pulling would discard unpushed local changes (${details.join('; ')}). Push them first, or pass force: true to discard them.`
  )
}

async function assertOutsideWorkspace(directory: string): Promise<void> {
  const enclosing = await readPullWorkspaceBinding(directory)
  if (enclosing) {
    throw new CodedError(
      'INVALID_INPUT',
      `"${directory}" is inside the workspace of app ${enclosing.appId}; choose a folder outside it.`
    )
  }
}

async function newWorkspaceDirectory(parent: string, folder: string): Promise<string> {
  const target = resolveAppDirectory(parent, folder)
  const manifest = await fs.lstat(path.join(target, APP_MANIFEST_FILENAME)).catch(() => undefined)
  if (manifest) {
    throw new CodedError(
      'WORKSPACE_EXISTS',
      `"${target}" is already an app workspace; pass it as directory to refresh it.`
    )
  }
  await assertAppDirectoryAvailable(target)
  return target
}

function installerFor(target: 'sub-account' | 'agency', installer: 'everyone' | 'agency-only' | undefined) {
  if (target === 'agency' && installer) {
    throw new CodedError('INVALID_INPUT', 'installer applies only to sub-account apps; agencies install agency apps.')
  }
  if (target === 'sub-account' && !installer) {
    throw new CodedError(
      'INVALID_INPUT',
      'Sub-account apps need installer: "everyone" (agencies and sub-accounts) or "agency-only". Ask the user which.'
    )
  }
  return installer
}

function pulledText(directory: string, snapshot: PullSnapshot): string {
  const { version, workflowActions, workflowTriggers, billing } = snapshot
  const counts = [
    [workflowActions.actions.length, 'workflow action(s)'],
    [workflowTriggers.triggers.length, 'workflow trigger(s)'],
    [billing.subscriptions.plans.length + billing.usage.meters.length, 'billing plan(s) and meter(s)']
  ] as const
  const contents = counts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`)
  const others = snapshot.versions.filter(item => item._id !== version._id)
  return [
    `Pulled "${oneLine(pulledSelection(snapshot).name, 100)}" ${versionLabel(version)} (appId ${oneLine(snapshot.selected.appId, 128)}, versionId ${oneLine(version._id, 128)}) into ${directory}.`,
    contents.length > 0 ? `Contains ${contents.join(', ')}.` : 'No workflow actions, triggers, or billing plans yet.',
    ...(others.length > 0
      ? [
          `Other versions: ${others.map(item => `${versionLabel(item)} (${oneLine(item._id, 128)})`).join('; ')}. Pass version to pull one instead.`
        ]
      : []),
    'Next: edit the files (rules: search-docs kind "cli"), then call check-workspace.'
  ].join('\n')
}

interface PullRequest {
  appId?: string
  directory: string
  folder?: string
  version?: string
  force: boolean
  withTypes: boolean
}

/* A workspace at or above `directory` is refreshed; any other folder needs
   an appId and receives a new workspace folder. */
async function pullSource(directory: string, appId: string | undefined): Promise<PullWorkspaceBinding | undefined> {
  const workspace = await readPullWorkspaceBinding(directory)
  if (workspace && appId && appId !== workspace.appId) {
    throw new CodedError(
      'WORKSPACE_MISMATCH',
      `"${workspace.directory}" belongs to app ${workspace.appId}. Pass a folder outside it to pull app ${appId}.`
    )
  }
  if (!workspace && !appId) {
    throw new CodedError('NO_APP', `"${directory}" is not an app workspace; pass the appId to pull into it.`)
  }
  return workspace
}

async function pullApp(config: CliConfig, request: PullRequest): Promise<string> {
  const workspace = await pullSource(request.directory, request.appId)
  if (workspace && !request.force) await assertNothingUnpushed(workspace)
  const client = await portalClient(config)
  /* Like get-app, a new pull starts from the latest version: edits go to the draft. */
  const version =
    request.version ?? (workspace || !request.appId ? undefined : (await client.getLatestVersion(request.appId))._id)
  const snapshot = await loadPullSnapshot(client, config, { workspace, appId: request.appId, version })
  const name = snapshot.version.name ?? snapshot.selected.name ?? snapshot.selected.appId
  const target =
    workspace?.directory ??
    (await newWorkspaceDirectory(request.directory, request.folder ?? slugifyAppName(name, snapshot.selected.appId)))
  const options = { refresh: workspace !== undefined, force: request.force, withTypes: request.withTypes }
  await writePulledWorkspace(target, snapshot, await preparePullDestination(target, snapshot, options), options)
  /* The files are written either way, so a selection failure is a note, not an error. */
  const selection = await persistSelection(client, config, pulledSelection(snapshot)).then(
    () => '',
    (error: unknown) => `\nThe app selection could not be saved: ${oneLine(errorMessage(error, 'unknown error'))}`
  )
  return `${pulledText(target, snapshot)}${selection}`
}

export function appsToolset(config: CliConfig): Toolset {
  return {
    name: 'apps',
    instructions: [],
    tools: [
      defineTool({
        name: 'get-app',
        title: 'Show an app from the developer portal',
        description:
          'One app version as the portal has it: status, all versions, OAuth scopes, redirect URIs, client key names, webhooks, billing, support, workflow actions and triggers, and for drafts the publish-readiness gaps with fixes and the next version number.',
        input: appInput,
        annotations: READ_ONLY_PORTAL,
        run: async target => {
          const client = await portalClient(config)
          return textResult(appOverviewText(await loadAppOverview(client, config, target)))
        }
      }),
      defineTool({
        name: 'create-app',
        title: 'Create a marketplace app',
        description:
          'Creates a new app in the developer portal and its local workspace, and selects it. Only when the user asks for a new app; confirm the name, type, target, installer, and listing with them first.',
        input: createInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        run: async ({ name, type, target, installer, listing, directory, folder }) => {
          const answers = { name, type, target, installer: installerFor(target, installer), listing }
          await assertOutsideWorkspace(directory)
          const workspaceDirectory = await newWorkspaceDirectory(directory, folder ?? slugifyAppName(name))
          const client = await portalClient(config)
          const created = await client.createApp(buildCreateAppBody(answers))
          const { selected, files } = await initializeCreatedApp(client, config, created, workspaceDirectory)
          return textResult(
            [
              `Created "${oneLine(selected.name, 100)}" (appId ${oneLine(selected.appId, 128)}, versionId ${oneLine(selected.versionId, 128)}) as a draft, with its workspace at ${files.directory}.`,
              'Next: add OAuth scopes and a redirect URI in ghl-app.json (list-scopes has exact names; rules: search-docs kind "cli"), then call check-workspace.'
            ].join('\n')
          )
        }
      }),
      defineTool({
        name: 'pull-app',
        title: 'Pull an app into a local workspace',
        description:
          'Writes an app version from the developer portal into a local workspace (app, webhooks, workflow actions and triggers, billing), creating a new folder or refreshing an existing workspace. Refuses to overwrite unpushed local changes unless forced.',
        input: pullInput,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        run: async request => textResult(await pullApp(config, request))
      }),
      defineTool({
        name: 'list-scopes',
        title: 'List OAuth scopes and webhook events',
        description:
          'The exact OAuth scope names the developer portal accepts, the token types (sub-account, agency) each allows, and the webhook events each scope unlocks. Use it to choose scopes and events for ghl-app.json.',
        input: scopesInput,
        annotations: READ_ONLY_PORTAL,
        run: async ({ query, target }) => {
          const client = await portalClient(config)
          const [catalog, webhooks] = await Promise.all([client.getScopesCatalog(), client.getWebhooksCatalog()])
          const options = { query, ...(target ? { userTypes: TARGET_USER_TYPES[target] } : {}) }
          return textResult(scopesText(scopeReferences(catalog, webhooks, options), { query, target }))
        }
      })
    ]
  }
}
