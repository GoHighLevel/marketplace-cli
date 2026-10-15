import path from 'node:path'

import { z } from 'zod'

import { findWorkspacesBelow, type PullWorkspaceBinding, readPullWorkspaceBinding } from '../../app/pull.js'
import { type ModulePushResult, pushWorkspace } from '../../app/workspace-push.js'
import {
  checkWorkspace,
  errorItems,
  type ModuleCheck,
  type WorkspaceCheck,
  type WorkspaceModuleName
} from '../../app/workspace-check.js'
import type { CliConfig } from '../../config/environment.js'
import { CodedError } from '../../shared/errors.js'
import { workflowActionCodeFilename } from '../../workflows/actions/code.js'
import { WORKFLOW_ACTIONS_RESOURCE } from '../../workflows/actions/resource.js'
import { runWorkflowActionTest, type WorkflowActionTestRun } from '../../workflows/actions/test-run.js'
import {
  WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH,
  WORKFLOW_ACTIONS_GUIDE_FILENAME
} from '../../workflows/actions/workspace.js'
import {
  scaffoldWorkflowItem,
  WORKFLOW_KEY_PATTERN,
  type WorkflowScaffoldResult
} from '../../workflows/shared/scaffold.js'
import { WORKFLOW_TRIGGERS_GUIDE_FILENAME } from '../../workflows/triggers/guide.js'
import { WORKFLOW_TRIGGERS_RESOURCE } from '../../workflows/triggers/resource.js'
import { WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH } from '../../workflows/triggers/workspace.js'
import { absolutePath } from '../inputs.js'
import { portalClient, whenLoggedIn } from '../portal.js'
import { oneLine } from '../text.js'
import { defineTool, textResult, type ToolContext, type Toolset } from '../tool.js'

const MODULE_LABELS: Readonly<Record<WorkspaceModuleName, string>> = {
  actions: 'Workflow actions',
  triggers: 'Workflow triggers',
  billing: 'Billing plans and meters',
  app: 'App (ghl-app.json, webhooks)'
}
const MODULE_GUIDES: Readonly<Record<WorkflowModuleKind, string>> = {
  action: path.join(WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH, WORKFLOW_ACTIONS_GUIDE_FILENAME),
  trigger: path.join(WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH, WORKFLOW_TRIGGERS_GUIDE_FILENAME)
}
const MAX_LISTED_PATHS = 20
const MAX_LISTED_ERRORS = 40

const WORKFLOW_MODULE_KINDS = ['action', 'trigger'] as const
type WorkflowModuleKind = (typeof WORKFLOW_MODULE_KINDS)[number]

interface WorkflowModuleRequest {
  kind: WorkflowModuleKind
  name: string
  key: string
}

type ScaffoldOutcome = { request: WorkflowModuleRequest } & ({ created: WorkflowScaffoldResult } | { error: unknown })

const PLAN_ID = /^[0-9a-f]{12}$/

const workspaceDirectory = () => absolutePath().describe('Absolute path of the app workspace or any folder inside it.')

const scaffoldInput = {
  directory: workspaceDirectory(),
  modules: z
    .array(
      z.object({
        kind: z.enum(WORKFLOW_MODULE_KINDS),
        name: z.string().trim().min(1).max(100),
        key: z.string().trim().max(100).regex(WORKFLOW_KEY_PATTERN)
      })
    )
    .min(1)
    .max(10)
    .describe('Actions or triggers to add: kind, display name, and a stable snake_case key.'),
  typescript: z.boolean().default(false).describe('New actions get a typed TypeScript handler instead of JavaScript.')
}

const MAX_TEST_OUTPUT = 6_000
const MAX_TEST_INPUT = 64_000
const MAX_CONSOLE_LINES = 30

const testInput = {
  directory: workspaceDirectory(),
  key: z.string().trim().min(1).max(100).describe('The workflow action key.'),
  input: z
    .record(z.string(), z.unknown())
    .default({})
    .refine(value => JSON.stringify(value).length <= MAX_TEST_INPUT, 'Test input must be at most 64 KB of JSON.')
    .describe('Input values keyed by field, as the workflow sends.'),
  version: z.string().trim().min(1).max(20).optional().describe('Defaults to the draft, else the newest version.'),
  locationId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional()
    .describe('A sub-account with the app installed, for location data and external auth.')
}

const pushInput = {
  directory: workspaceDirectory(),
  planId: z
    .string()
    .trim()
    .regex(PLAN_ID, 'Use the planId from check-workspace.')
    .describe('The planId check-workspace returned for the changes the user approved.')
}

const checkInput = {
  directory: workspaceDirectory(),
  remote: z.boolean().default(true).describe('Also compare with the developer portal; false checks local files only.')
}

function listed(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_LISTED_PATHS).map(path => oneLine(path, 200))
  const more = paths.length > shown.length ? ` and ${paths.length - shown.length} more` : ''
  return `${shown.join(', ')}${more}`
}

function moduleText(module: ModuleCheck, compared: boolean): string {
  const label = `${MODULE_LABELS[module.name]}${module.items === undefined ? '' : ` (${module.items})`}`
  const parts = [
    module.errors.length > 0 ? `${module.errors.length} error(s)` : 'valid',
    ...(module.unreadable
      ? []
      : [module.localChanges.length > 0 ? `local changes: ${listed(module.localChanges)}` : 'no local changes']),
    ...(compared && !module.remoteError && module.errors.length === 0
      ? [
          module.portalChanges.length > 0
            ? `portal changes since the last pull: ${listed(module.portalChanges)}`
            : 'no portal changes'
        ]
      : []),
    ...(module.conflicts.length > 0 ? [`conflicts: ${listed(module.conflicts)}`] : []),
    ...(module.operations.length > 0 && module.errors.length === 0 ? [`push: ${listed(module.operations)}`] : []),
    ...(module.secretTargets.length > 0
      ? [`sends header secrets to new destinations (the user must approve): ${listed(module.secretTargets)}`]
      : []),
    ...(module.remoteError ? [`portal comparison failed: ${oneLine(module.remoteError)}`] : [])
  ]
  const errors = module.errors.slice(0, MAX_LISTED_ERRORS).map(error => `- ${oneLine(error, 1_000)}`)
  const more = module.errors.length > errors.length ? [`- and ${module.errors.length - errors.length} more`] : []
  return [`${label}: ${parts.join('; ')}.`, ...errors, ...more].join('\n')
}

function nextStep(check: WorkspaceCheck): string {
  const modules = check.modules
  if (modules.some(module => module.errors.length > 0)) {
    return 'Next: fix every error above, then call check-workspace again.'
  }
  if (modules.some(module => module.conflicts.length > 0)) {
    return 'Next: the portal changed the same fields since the last pull. Ask the user which value to keep; pull-app with force: true takes the portal version, then reapply the local edits.'
  }
  if (check.planId) {
    return `Next: show the user these changes; once they approve, call push-workspace with planId ${check.planId}.`
  }
  if (modules.some(module => module.localChanges.length > 0)) {
    return 'Next: compare with the portal (check-workspace with remote: true, logged in) to get a push plan.'
  }
  if (modules.some(module => module.portalChanges.length > 0)) {
    return 'Next: the portal is ahead of these files; pull-app refreshes them.'
  }
  return check.compared ? 'Everything matches the developer portal.' : 'No local changes since the last pull.'
}

function checkText(check: WorkspaceCheck, offlineReason?: string, withNextStep = true): string {
  const scope = check.compared
    ? 'compared with the developer portal'
    : `local files only${check.remoteError ? ` (portal unavailable: ${oneLine(check.remoteError)})` : offlineReason ? ` (${offlineReason})` : ''}`
  return [
    `Workspace ${check.directory} (appId ${check.appId}, versionId ${check.versionId}), ${scope}.`,
    ...check.modules.map(module => moduleText(module, check.compared)),
    ...(withNextStep ? [nextStep(check)] : [])
  ].join('\n')
}

function pushApprovalMessage(check: WorkspaceCheck): string {
  const changes = check.modules
    .filter(module => module.localChanges.length > 0)
    .map(module =>
      [
        `${MODULE_LABELS[module.name]}: ${listed(module.operations)}`,
        ...module.changeDetails.map(detail => `  ${oneLine(detail, 300)}`)
      ].join('\n')
    )
  const secrets = check.modules.flatMap(module => module.secretTargets)
  return [
    `Push these changes from ${check.directory} to app ${check.appId} (version ${check.versionId})?`,
    ...changes,
    ...(secrets.length > 0
      ? ['Header secrets sent to new destinations:', ...secrets.map(secret => `- ${oneLine(secret, 300)}`)]
      : [])
  ].join('\n')
}

/* A closed dialog is not a yes: nothing happens without the user's answer. */
function notAnswered(outcome: string, alternative: string): CodedError {
  return new CodedError(
    'CONFIRMATION_REQUIRED',
    `The approval dialog was closed without an answer, so ${outcome}. Ask the user to approve it in an interactive session, or ${alternative}.`
  )
}

async function approveSecretTargets(targets: readonly string[], confirm: ToolContext['confirm']): Promise<void> {
  const listedTargets = targets.map(target => oneLine(target, 300)).join('; ')
  const answer = await confirm(`Send these header secrets to new destinations during the test? ${listedTargets}`)
  if (answer === 'decline') {
    throw new CodedError('DECLINED', 'The user declined sending the header secrets; the test did not run.')
  }
  if (answer === 'cancel') throw notAnswered('the test did not run', 'run `ghl app actions test` instead')
  if (answer === undefined) {
    throw new CodedError(
      'CONFIRMATION_REQUIRED',
      `The test sends header secrets to new destinations (${listedTargets}). That needs the user's direct approval, which this client cannot ask for; the user can run \`ghl app actions test\` instead.`
    )
  }
}

/* The user approves the push directly. Without a client that can ask, the
   client's own tool approval stands in, except for secrets sent somewhere new,
   which never leave without the user's direct yes. */
async function approvePush(check: WorkspaceCheck, confirm: ToolContext['confirm']): Promise<void> {
  const answer = await confirm(pushApprovalMessage(check))
  if (answer === 'decline') throw new CodedError('DECLINED', 'The user declined the push; nothing was pushed.')
  if (answer === 'cancel')
    throw notAnswered('nothing was pushed', 'push with the CLI (`ghl app push` and the module push commands)')
  const secrets = check.modules.flatMap(module => module.secretTargets)
  if (answer === undefined && secrets.length > 0) {
    throw new CodedError(
      'CONFIRMATION_REQUIRED',
      `This push sends header secrets to new destinations (${secrets.map(secret => oneLine(secret, 300)).join('; ')}). That needs the user's direct approval, which this client cannot ask for; the user can push from the CLI instead (ghl app actions push, ghl app triggers push).`
    )
  }
}

function pushResultLine(result: ModulePushResult): string {
  const label = MODULE_LABELS[result.name]
  if (result.error) return `${label}: not pushed: ${oneLine(result.error, 1_000)}`
  const applied = result.applied.length > 0 ? listed(result.applied) : 'nothing to apply'
  const failed = result.failed.length > 0 ? `; failed: ${result.failed.map(item => oneLine(item, 500)).join('; ')}` : ''
  const version = result.versionId ? `; the workspace is now bound to versionId ${oneLine(result.versionId, 128)}` : ''
  return `${label}: ${applied}${failed}${version}.`
}

/* Pushed action and trigger drafts are tested and published on their own. */
export function nextAfterPush(results: readonly ModulePushResult[]): string {
  const drafted = (name: 'actions' | 'triggers') =>
    results.some(result => result.name === name && result.applied.some(operation => !operation.startsWith('delete')))
  if (!drafted('actions') && !drafted('triggers')) {
    return 'Next: get-app shows publish readiness; release-app publishes when the user asks.'
  }
  const test = drafted('actions') ? 'test-workflow-action tries actions; ' : ''
  return `Next: ${test}when the user asks, release-workflow-module publishes action and trigger drafts and release-app the app.`
}

function pushText(directory: string, complete: boolean, results: readonly ModulePushResult[]): string {
  return [
    complete ? `Pushed ${directory} to the developer portal:` : `Push of ${directory} stopped:`,
    ...results.map(result => `- ${pushResultLine(result)}`),
    complete ? nextAfterPush(results) : 'Next: fix the failure, then call check-workspace for a new plan.'
  ].join('\n')
}

function testText(run: WorkflowActionTestRun): string {
  const output = JSON.stringify(run.output) ?? 'undefined'
  const shown = output.length > MAX_TEST_OUTPUT ? `${output.slice(0, MAX_TEST_OUTPUT)}… (truncated)` : output
  const logs = run.consoleLogs.slice(0, MAX_CONSOLE_LINES).map(line => `  ${oneLine(line, 300)}`)
  return [
    `Test passed: action ${run.key} version ${oneLine(run.version, 20)} (${run.type}).`,
    `Output: ${shown}`,
    ...(logs.length > 0 ? ['Console:', ...logs] : [])
  ].join('\n')
}

/* The workspace containing `directory`, or an error listing those below it. */
async function requireWorkspace(directory: string): Promise<PullWorkspaceBinding> {
  const binding = await readPullWorkspaceBinding(directory)
  if (binding) return binding
  const found = await findWorkspacesBelow(directory)
  throw new CodedError(
    'NO_WORKSPACE',
    found.length > 0
      ? `No app workspace contains "${directory}". Workspaces below it: ${found.join(', ')}. Pass one as directory.`
      : `No app workspace contains "${directory}" or sits below it. pull-app or create-app makes one.`
  )
}

async function scaffoldModule(
  directory: string,
  request: WorkflowModuleRequest,
  typescript: boolean
): Promise<WorkflowScaffoldResult> {
  if (request.kind === 'trigger') {
    const workspace = await WORKFLOW_TRIGGERS_RESOURCE.loadWorkspace(directory)
    return scaffoldWorkflowItem(WORKFLOW_TRIGGERS_RESOURCE, workspace, request)
  }
  const workspace = await WORKFLOW_ACTIONS_RESOURCE.loadWorkspace(directory)
  return scaffoldWorkflowItem(WORKFLOW_ACTIONS_RESOURCE, workspace, { ...request, typescript })
}

/* Each module is added in turn, so one invalid request never undoes the
   others; every outcome is reported. */
async function scaffoldModules(
  directory: string,
  requests: readonly WorkflowModuleRequest[],
  typescript: boolean
): Promise<ScaffoldOutcome[]> {
  const outcomes: ScaffoldOutcome[] = []
  for (const request of requests) {
    try {
      outcomes.push({ request, created: await scaffoldModule(directory, request, typescript) })
    } catch (error) {
      outcomes.push({ request, error })
    }
  }
  return outcomes
}

function createdLine(
  directory: string,
  request: WorkflowModuleRequest,
  created: WorkflowScaffoldResult,
  typescript: boolean
): string {
  const file = path.relative(directory, created.file)
  const handler =
    request.kind === 'action'
      ? `, handler ${path.join(path.dirname(file), 'code', workflowActionCodeFilename(created.key, created.version, typescript ? 'typescript' : 'javascript'))}`
      : ''
  return `- ${request.kind} ${created.key} "${created.name}": ${file}${handler}`
}

function scaffoldText(directory: string, outcomes: readonly ScaffoldOutcome[], typescript: boolean): string {
  const created = outcomes.flatMap(outcome =>
    'created' in outcome ? [createdLine(directory, outcome.request, outcome.created, typescript)] : []
  )
  const failed = outcomes.flatMap(outcome =>
    'error' in outcome
      ? [`- ${outcome.request.kind} ${outcome.request.key}: ${oneLine(errorItems(outcome.error).join(' '), 1_000)}`]
      : []
  )
  const prerequisites = [
    ...new Set(outcomes.flatMap(outcome => ('created' in outcome ? outcome.created.prerequisites : [])))
  ]
  const kinds = [...new Set(outcomes.filter(outcome => 'created' in outcome).map(outcome => outcome.request.kind))]
  const guides = kinds.map(kind => MODULE_GUIDES[kind]).join(' and ')
  return [
    ...(created.length > 0 ? [`Added to ${directory} (local drafts until pushed):`, ...created] : []),
    ...(failed.length > 0 ? ['Not added:', ...failed] : []),
    ...(prerequisites.length > 0 ? ['Required before pushing:', ...prerequisites.map(item => `- ${item}`)] : []),
    ...(created.length > 0
      ? [
          `Next: fill in the generated files following ${guides} (also searchable with search-docs kind "cli"), then call check-workspace.`
        ]
      : [])
  ].join('\n')
}

export function workspaceToolset(config: CliConfig): Toolset {
  return {
    name: 'workspace',
    instructions: [
      'After editing workspace files, call check-workspace and fix every error. Push only after the user approves the listed changes, with push-workspace and the planId from check-workspace.'
    ],
    tools: [
      defineTool({
        name: 'check-workspace',
        title: 'Validate an app workspace and compare it with the portal',
        description:
          'Validates every file of a local app workspace (app, webhooks, workflow actions and triggers, billing) and compares it with the developer portal: local changes, portal changes, conflicts, and the push commands. Lists the workspaces below a folder that is not one.',
        input: checkInput,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        run: async ({ directory, remote }) => {
          const binding = await requireWorkspace(directory)
          const client = remote ? await whenLoggedIn(portalClient(config)) : undefined
          const offlineReason = remote && !client ? 'not logged in; call login to compare with the portal' : undefined
          return textResult(checkText(await checkWorkspace(binding, client), offlineReason))
        }
      }),
      defineTool({
        name: 'test-workflow-action',
        title: 'Test a workflow action',
        description:
          'Runs the local (unpushed) configuration of a workflow action through the portal test runner with the given input, and returns its output and console logs. The action may call its real endpoints.',
        input: testInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        run: async ({ directory, key, input, version, locationId }, { confirm }) => {
          const binding = await requireWorkspace(directory)
          const run = await runWorkflowActionTest({
            directory: binding.directory,
            action: key,
            version,
            inputData: input,
            locationId,
            client: await portalClient(config),
            redactSecrets: true,
            approveSecrets: targets => approveSecretTargets(targets, confirm)
          })
          return textResult(testText(run))
        }
      }),
      defineTool({
        name: 'push-workspace',
        title: 'Push a reviewed workspace plan to the portal',
        description:
          'Applies the plan check-workspace returned (app, webhooks, workflow actions and triggers, billing) in the order the portal requires, verifies it, and updates the local baseline. Refuses if anything changed since the plan was made.',
        input: pushInput,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        run: async ({ directory, planId }, { confirm }) => {
          const binding = await requireWorkspace(directory)
          const outcome = await pushWorkspace(binding, await portalClient(config), planId, check =>
            approvePush(check, confirm)
          )
          if (outcome.status === 'plan-changed') {
            throw new CodedError(
              'PLAN_CHANGED',
              `The workspace or the portal changed since that plan was made; nothing was pushed. Show the user the current state and get their approval before pushing again:\n${checkText(outcome.check, undefined, false)}`
            )
          }
          const result = textResult(pushText(binding.directory, outcome.complete, outcome.results))
          return outcome.complete ? result : { ...result, isError: true }
        }
      }),
      defineTool({
        name: 'scaffold-workflow-module',
        title: 'Add workflow actions or triggers to a workspace',
        description:
          'Adds draft workflow actions or triggers (up to 10 per call) to a local app workspace: a JSON file each, plus a handler source for actions. Local until pushed; returns the files to fill in.',
        input: scaffoldInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        run: async ({ directory, modules, typescript }) => {
          const binding = await requireWorkspace(directory)
          const outcomes = await scaffoldModules(binding.directory, modules, typescript)
          const result = textResult(scaffoldText(binding.directory, outcomes, typescript))
          return outcomes.some(outcome => 'created' in outcome) ? result : { ...result, isError: true }
        }
      })
    ]
  }
}
