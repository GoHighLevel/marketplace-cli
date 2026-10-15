import { z } from 'zod'

import type { ApiClient } from '../../api/client.js'
import { findAppItemById } from '../../app/context.js'
import { loadTargetContext } from '../../app/overview.js'
import { readPullWorkspaceBinding, resolveVersionId } from '../../app/pull.js'
import {
  allowedVersions,
  createDraftFromLive,
  type DeprecationRequest,
  executeDeprecation,
  executePublish,
  latestLiveVersion,
  localTimezone,
  prepareDeprecation,
  preparePublish,
  prepareSecurityReview,
  REVIEW_STATUSES,
  type ReleaseTarget,
  resolvePublishRequest,
  validateDeprecationRequest,
  withdrawFromReview
} from '../../app/release.js'
import { normalizeStatus } from '../../app/rules.js'
import type { CliConfig } from '../../config/environment.js'
import { CodedError, errorMessage } from '../../shared/errors.js'
import { WORKFLOW_ACTIONS_RESOURCE } from '../../workflows/actions/resource.js'
import {
  createWorkflowItemVersion,
  loadWorkflowReleaseContext,
  publishWorkflowItem,
  selectPublishCandidate,
  type WorkflowReleaseResult,
  workflowPublishCandidates
} from '../../workflows/shared/release.js'
import type {
  WorkflowResource,
  WorkflowResourceManifest,
  WorkflowResourcePlan,
  WorkflowResourceWorkspace
} from '../../workflows/shared/resource.js'
import { WORKFLOW_TRIGGERS_RESOURCE } from '../../workflows/triggers/resource.js'
import { absolutePath, appId, required } from '../inputs.js'
import { portalClient } from '../portal.js'
import { oneLine } from '../text.js'
import { defineTool, textResult, type Toolset } from '../tool.js'

const APP_RELEASE_ACTIONS = ['publish', 'withdraw', 'create-draft', 'deprecate', 'security-review'] as const
const MODULE_RELEASE_ACTIONS = ['publish', 'new-version'] as const
const RELEASE_WRITE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
} as const

type AppReleaseAction = (typeof APP_RELEASE_ACTIONS)[number]

interface AppReleaseRequest {
  action: AppReleaseAction
  appId?: string
  directory?: string
  version?: string
  notes?: string
  subAccountNotes?: string
  date?: string
}

const notesText = () => z.string().trim().min(1).max(2_000)

const appReleaseInput = {
  action: z.enum(APP_RELEASE_ACTIONS).describe('The release step.'),
  appId: appId().optional().describe('Defaults to the app of directory, then the selected app.'),
  directory: absolutePath().optional().describe('App workspace to keep in sync.'),
  version: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .optional()
    .describe('publish: new version (default: suggested). deprecate: the live version.'),
  notes: notesText().optional().describe('publish: agency release notes. deprecate: notes for users.'),
  subAccountNotes: notesText().optional().describe('publish: sub-account release notes.'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('deprecate: YYYY-MM-DD, 3+ days ahead.')
}

const moduleReleaseInput = {
  directory: absolutePath().describe('Absolute path of the app workspace or any folder inside it.'),
  action: z.enum(MODULE_RELEASE_ACTIONS).describe('publish a draft version, or start a new-version draft.'),
  kind: z.enum(['action', 'trigger']).describe('Workflow action or trigger.'),
  key: z.string().trim().min(1).max(100).describe('The module key.'),
  version: z.string().trim().min(1).max(20).optional().describe('publish: the draft version (default: current draft).'),
  notes: notesText().optional().describe('publish: release change log (required).')
}

async function atVersion(target: ReleaseTarget, versionId: string): Promise<ReleaseTarget> {
  const selected = { ...target.selected, versionId }
  return { ...target, selected, version: await target.client.getVersion(selected.appId, versionId) }
}

function versionNumber(version: { version?: string; _id: string }): string {
  return oneLine(version.version ?? version._id, 40)
}

function appName(target: ReleaseTarget): string {
  return `"${oneLine(target.version.name ?? target.selected.name ?? target.selected.appId, 100)}"`
}

/* The directory only syncs a workspace bound to the released version. */
async function boundWorkspace(request: AppReleaseRequest): Promise<string | undefined> {
  return request.directory ? (await readPullWorkspaceBinding(request.directory))?.directory : undefined
}

async function publish(target: ReleaseTarget, request: AppReleaseRequest): Promise<string> {
  const preparation = await preparePublish(target)
  let publishRequest
  try {
    publishRequest = resolvePublishRequest(preparation, {
      version: request.version,
      agencyNotes: request.notes,
      subAccountNotes: request.subAccountNotes
    })
  } catch (error) {
    const choices = preparation.options.length > 0 ? ` Allowed versions: ${allowedVersions(preparation)}.` : ''
    throw new CodedError('INVALID_INPUT', `${errorMessage(error, 'Invalid publish request.')}${choices}`)
  }
  await executePublish(target, preparation, publishRequest, await boundWorkspace(request))
  return preparation.isPrivate
    ? `Published ${appName(target)} ${publishRequest.newVersion}; it is live for new installs.`
    : `Submitted ${appName(target)} ${publishRequest.newVersion} for marketplace review; get-app shows its status.`
}

async function withdraw(target: ReleaseTarget, request: AppReleaseRequest): Promise<string> {
  const versions = await target.client.listVersions(target.selected.appId)
  const inReview = versions.find(item => REVIEW_STATUSES.includes(normalizeStatus(item.status)))
  if (!inReview) throw new CodedError('INVALID_STATE', `No version of ${appName(target)} is in review.`)
  await withdrawFromReview(await atVersion(target, inReview._id), await boundWorkspace(request))
  return `Withdrew ${appName(target)} ${versionNumber(inReview)} from review; it is a draft again.`
}

async function createDraft(target: ReleaseTarget): Promise<string> {
  const live = await latestLiveVersion(target.client, target.selected.appId)
  const draftId = await createDraftFromLive({
    ...target,
    selected: { ...target.selected, versionId: live._id },
    version: live
  })
  return `Created draft ${draftId} from live ${versionNumber(live)}. pull-app with version ${draftId} edits it locally.`
}

/* Checked before any portal call. */
function deprecationInput(request: AppReleaseRequest): DeprecationRequest & { version: string } {
  if (!request.version || !request.date || !request.notes) {
    throw new CodedError('INVALID_INPUT', 'deprecate needs version (the live version), date, and notes.')
  }
  const deprecation = { date: request.date, timezone: localTimezone(), notes: request.notes }
  return { version: request.version, ...validateDeprecationRequest(deprecation) }
}

async function deprecate(target: ReleaseTarget, input: DeprecationRequest & { version: string }): Promise<string> {
  const { version, ...deprecation } = input
  const versions = await target.client.listVersions(target.selected.appId)
  const deprecated = await atVersion(target, resolveVersionId(versions, version, ''))
  await prepareDeprecation(deprecated)
  await executeDeprecation(deprecated, deprecation)
  return `Scheduled deprecation of ${appName(target)} ${versionNumber(deprecated.version)} on ${deprecation.date} (${deprecation.timezone}).`
}

async function securityReview(target: ReleaseTarget): Promise<string> {
  const { client, selected } = target
  const app = await findAppItemById(client, selected.appId, selected.name)
  const live = await prepareSecurityReview(client, selected.appId, app.agencyInstallCount ?? 0)
  await client.requestSecurityReview(selected.appId)
  return `Requested a security review of ${appName(target)} (live ${versionNumber(live)}).`
}

async function releaseApp(config: CliConfig, request: AppReleaseRequest): Promise<string> {
  const deprecation = request.action === 'deprecate' ? deprecationInput(request) : undefined
  const target = await loadTargetContext(await portalClient(config), config, request)
  if (request.action === 'publish') return publish(target, request)
  if (request.action === 'withdraw') return withdraw(target, request)
  if (request.action === 'create-draft') return createDraft(target)
  if (deprecation) return deprecate(target, deprecation)
  return securityReview(target)
}

async function releaseModule<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  client: ApiClient,
  request: { directory: string; action: 'publish' | 'new-version'; key: string; version?: string; notes?: string }
): Promise<WorkflowReleaseResult> {
  /* Checked before any portal call: a publish without a change log cannot succeed. */
  const notes =
    request.action === 'publish' ? required(request.notes, 'publish needs notes: the release change log.') : undefined
  const context = await loadWorkflowReleaseContext(resource, request.directory, { purpose: request.action, client })
  if (notes === undefined) return createWorkflowItemVersion(resource, context, request.key)
  const candidates = workflowPublishCandidates(resource, context, request.version)
  return publishWorkflowItem(
    resource,
    context,
    selectPublishCandidate(resource, context, candidates, request.key),
    notes
  )
}

export function releaseToolset(config: CliConfig): Toolset {
  return {
    name: 'release',
    instructions: [
      "Release only on the user's explicit request: push-workspace first, check get-app readiness, then release-app or release-workflow-module."
    ],
    tools: [
      defineTool({
        name: 'release-app',
        title: 'Publish, withdraw, draft, or deprecate an app version',
        description:
          'Releases an app version: publish (private apps go live, public apps enter review), withdraw a review, create a draft from live, schedule deprecation, or request a security review.',
        input: appReleaseInput,
        annotations: RELEASE_WRITE,
        run: async request => textResult(await releaseApp(config, request))
      }),
      defineTool({
        name: 'release-workflow-module',
        title: 'Publish a workflow action or trigger version',
        description:
          'Publishes the pushed draft version of a workflow action or trigger, or starts a new draft version of a published one, then refreshes the workspace files.',
        input: moduleReleaseInput,
        annotations: RELEASE_WRITE,
        run: async ({ kind, ...request }) => {
          const client = await portalClient(config)
          const released =
            kind === 'action'
              ? await releaseModule(WORKFLOW_ACTIONS_RESOURCE, client, request)
              : await releaseModule(WORKFLOW_TRIGGERS_RESOURCE, client, request)
          return textResult(
            request.action === 'publish'
              ? `Published ${kind} ${released.key} version ${oneLine(released.version, 20)}.`
              : `Created draft ${oneLine(released.version, 20)} of ${kind} ${released.key}; the workspace files now include it. Edit it, then check-workspace and push-workspace.`
          )
        }
      })
    ]
  }
}
