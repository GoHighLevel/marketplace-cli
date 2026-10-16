import type { ApiClient } from '../../api/client.js'
import { CodedError, errorMessage } from '../../shared/errors.js'
import { loadWorkflowSyncContext, workflowPlanError, type WorkflowSyncContext } from './context.js'
import {
  findWorkflowItem,
  hasDraftVersion,
  type WorkflowResource,
  type WorkflowResourceDefinition,
  type WorkflowResourceManifest,
  type WorkflowResourcePlan,
  type WorkflowResourcePublishCandidate,
  type WorkflowResourceWorkspace
} from './resource.js'

export interface WorkflowReleaseResult {
  key: string
  version: string
}

type Context<M, P, W, S> = WorkflowSyncContext<M, P, W, S>

/* Releases act on the portal state, so the local files must hold no
   unpushed work; the workspace is refreshed from the portal afterwards. */
export async function loadWorkflowReleaseContext<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  directory: string,
  options: { purpose: 'publish' | 'new-version'; client?: ApiClient }
): Promise<Context<M, P, W, S>> {
  const context = await loadWorkflowSyncContext(resource, directory, {
    requirePrerequisites: options.purpose === 'publish',
    client: options.client
  })
  const planError = workflowPlanError(resource, context.plan)
  if (planError) throw planError
  if (context.plan.localChanges.length > 0) {
    throw new Error(
      options.purpose === 'publish'
        ? `Push local workflow ${resource.singular} changes before publishing: \`ghl app ${resource.plural} push\`.`
        : `Push or discard local workflow ${resource.singular} changes before creating a new version.`
    )
  }
  return context
}

async function refreshWorkspace<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(resource: WorkflowResource<M, P, W, F, S>, context: Context<M, P, W, S>): Promise<F> {
  const remote = (await resource.fetchSnapshot(context.client, context.appId)).manifest
  return resource.preserveSourceWorkspace
    ? resource.writeWorkspace(context.directory, remote, remote, context.local)
    : resource.writeWorkspace(context.directory, remote)
}

export function workflowPublishCandidates<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  context: Context<M, P, W, S>,
  version?: string
): WorkflowResourcePublishCandidate[] {
  const candidates = resource.publishCandidates(context.remote, context.summaries, version)
  if (candidates.length === 0) {
    throw new Error(`No workflow ${resource.singular} has a matching draft or incomplete registry publication.`)
  }
  return candidates
}

/* The candidate for one item, checked against the stricter rules a
   submission must meet. */
export function selectPublishCandidate<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  context: Context<M, P, W, S>,
  candidates: readonly WorkflowResourcePublishCandidate[],
  selector: string
): WorkflowResourcePublishCandidate {
  const candidate = candidates.find(entry => entry.item.key === selector || entry.item.templateId === selector)
  if (!candidate?.item.templateId) {
    throw new Error(`Workflow ${resource.singular} "${selector}" has no publishable version.`)
  }
  if (!candidate.repairRegistry) {
    const errors = resource.validateManifest(context.remote, {
      publishable: true,
      key: candidate.item.key,
      version: candidate.version.version
    })
    if (errors.length > 0) {
      throw publishBlockedError(resource.label, resource.filenameFromKey(candidate.item.key), errors)
    }
  }
  return candidate
}

/* Publish checks run on the pushed (portal) version, whose errors name the
   portal's combined manifest; point at the file the developer edits instead. */
export function publishBlockedError(label: string, file: string, errors: readonly string[]): CodedError {
  const inFile = errors.map(error => error.replace(/^[\w-]+\.json\.\w+\[\d+\]/, file))
  return new CodedError(
    'INVALID_STATE',
    `${label} cannot be published:\n- ${inFile.join('\n- ')}\nFix ${file}, push it, then publish.`
  )
}

/* Submits the version (or only repairs its registry entry) and refreshes the
   local files from the portal. */
export async function publishWorkflowItem<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  context: Context<M, P, W, S>,
  candidate: WorkflowResourcePublishCandidate,
  notes: string
): Promise<WorkflowReleaseResult & { files: F }> {
  const templateId = candidate.item.templateId
  if (!templateId) throw new Error(`Workflow ${resource.singular} "${candidate.item.key}" has no publishable version.`)
  const { version } = candidate.version
  if (!notes.trim()) throw new Error('Release change log is required.')
  if (!candidate.repairRegistry) {
    await resource.submitForReview(context.client, context.appId, templateId, version, notes.trim())
  }
  try {
    await resource.publishSummary(context.client, context.appId, templateId, version)
  } catch (error) {
    if (candidate.repairRegistry) throw error
    throw new Error(
      `The workflow version was published, but its registry update failed: ${errorMessage(error, 'registry update failed')} ` +
        `Re-run this command with the same ${resource.singular} and version to repair the registry.`
    )
  }
  return { key: candidate.item.key, version, files: await refreshWorkspace(resource, context) }
}

export function newVersionCandidates(items: readonly WorkflowResourceDefinition[]): WorkflowResourceDefinition[] {
  return items.filter(item => !hasDraftVersion(item) && item.versions[0]?.status === 'published')
}

/* Starts a new draft version of a published item and refreshes the local
   files so the draft can be edited. */
export async function createWorkflowItemVersion<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  context: Context<M, P, W, S>,
  selector: string
): Promise<WorkflowReleaseResult & { files: F }> {
  const { singular } = resource
  const item = findWorkflowItem(resource.items(context.remote), selector)
  if (!item?.templateId) throw new CodedError('NOT_FOUND', `Workflow ${singular} "${selector}" was not found.`)
  if (hasDraftVersion(item)) throw new Error(`Workflow ${singular} "${item.key}" already has a draft version.`)
  if (item.versions[0]?.status !== 'published') {
    throw new Error(
      `Workflow ${singular} "${item.key}" must have a latest published version before creating a new draft.`
    )
  }
  const created = await resource.createVersion(context.client, context.appId, item.templateId)
  return { key: item.key, version: created.version, files: await refreshWorkspace(resource, context) }
}
