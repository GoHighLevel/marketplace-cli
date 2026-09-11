import { ApiClient } from '../../api/client.js'
import { resolveApp } from '../../app/context.js'
import { readPullWorkspaceBinding } from '../../app/pull.js'
import { getConfig } from '../../config/environment.js'
import {
  type WorkflowResource,
  type WorkflowResourceManifest,
  type WorkflowResourceNaming,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from './resource.js'

export interface WorkflowRemoteContext {
  appId: string
  client: ApiClient
  directory?: string
}

export interface WorkflowSyncContext<M, P, W, S> extends WorkflowRemoteContext {
  directory: string
  local: W
  remote: M
  runtime: M
  summaries: S[]
  plan: P
}

export interface WorkflowRemoteContextOptions {
  appId?: string
  directory?: string
  requireWorkspaceMatch?: boolean
}

export interface WorkflowSyncContextOptions {
  requirePrerequisites?: boolean
}

/* Resolves the app an app-scoped workflow command operates on: an explicit
   --app id, the enclosing workspace's binding, or the stored selection. */
export async function loadWorkflowRemoteContext(options: WorkflowRemoteContextOptions): Promise<WorkflowRemoteContext> {
  const directory = options.directory ?? process.cwd()
  const binding = await readPullWorkspaceBinding(directory)
  if (options.requireWorkspaceMatch && binding && options.appId && binding.appId !== options.appId) {
    throw new Error(`The workspace belongs to app "${binding.appId}", not "${options.appId}".`)
  }
  const config = getConfig()
  const client = new ApiClient(config)
  await client.init()
  const appId = options.appId
    ? options.requireWorkspaceMatch && binding?.appId === options.appId
      ? binding.appId
      : (await resolveApp(client, config, options.appId)).appId
    : (binding?.appId ?? (await resolveApp(client, config)).appId)
  return {
    appId,
    client,
    ...(binding && binding.appId === appId ? { directory: binding.directory } : {})
  }
}

/* Loads the local workspace first so validation failures never require a
   login, then fetches the portal state and plans the three-way sync. */
export async function loadWorkflowSyncContext<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  directory: string,
  options: WorkflowSyncContextOptions = {}
): Promise<WorkflowSyncContext<M, P, W, S>> {
  const local = await resource.loadWorkspace(directory)
  if (options.requirePrerequisites) {
    const errors = resource.prerequisiteErrors(local)
    if (errors.length > 0) {
      throw new Error(`${resource.label} prerequisites are not satisfied:\n- ${errors.join('\n- ')}`)
    }
  }
  const config = getConfig()
  const client = new ApiClient(config)
  await client.init()
  const snapshot = await resource.fetchSnapshot(client, local.manifest.appId)
  const plan = resource.planSync(local.state.baseline, local.manifest, snapshot.manifest)
  return {
    appId: local.manifest.appId,
    client,
    directory: local.directory,
    local,
    remote: snapshot.manifest,
    runtime: snapshot.runtime,
    summaries: snapshot.summaries,
    plan
  }
}

export function workflowPlanError(resource: WorkflowResourceNaming, plan: WorkflowResourcePlan): Error | undefined {
  if (plan.errors.length > 0) {
    return new Error(`${resource.label} configuration cannot be pushed:\n- ${plan.errors.join('\n- ')}`)
  }
  if (plan.conflicts.length > 0) {
    return new Error(
      `${resource.label} configuration conflicts with portal changes:\n- ${plan.conflicts.join('\n- ')}\n` +
        `Run \`ghl app ${resource.plural} pull\`, reapply the local changes, and retry.`
    )
  }
  return undefined
}
