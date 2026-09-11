import { ApiClient, type WorkflowActionSummary } from '../../api/client.js'
import { resolveApp } from '../../app/context.js'
import { readPullWorkspaceBinding } from '../../app/pull.js'
import { getConfig } from '../../config/environment.js'
import { fetchWorkflowActionsSnapshot } from './service.js'
import { workflowActionPrerequisiteErrors } from './contract.js'
import { type WorkflowActionsManifest } from './manifest.js'
import { planWorkflowActionsSync, type WorkflowActionsSyncPlan } from './sync.js'
import { loadWorkflowActionsWorkspace, type WorkflowActionsWorkspace } from './workspace.js'

export interface WorkflowActionsRemoteContext {
  appId: string
  client: ApiClient
  directory?: string
}

export interface WorkflowActionsSyncContext extends WorkflowActionsRemoteContext {
  directory: string
  local: WorkflowActionsWorkspace
  remote: WorkflowActionsManifest
  runtime: WorkflowActionsManifest
  summaries: WorkflowActionSummary[]
  plan: WorkflowActionsSyncPlan
}

export async function loadWorkflowActionsRemoteContext(options: {
  appId?: string
  directory?: string
  requireWorkspaceMatch?: boolean
}): Promise<WorkflowActionsRemoteContext> {
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

export async function loadWorkflowActionsSyncContext(
  directory: string,
  options: { requirePrerequisites?: boolean } = {}
): Promise<WorkflowActionsSyncContext> {
  const local = await loadWorkflowActionsWorkspace(directory)
  if (options.requirePrerequisites) {
    const errors = workflowActionPrerequisiteErrors(local.allowedScopes, local.manifest.actions.length)
    if (errors.length > 0) {
      throw new Error(`Workflow action prerequisites are not satisfied:\n- ${errors.join('\n- ')}`)
    }
  }
  const config = getConfig()
  const client = new ApiClient(config)
  await client.init()
  const snapshot = await fetchWorkflowActionsSnapshot(client, local.manifest.appId)
  const remote = snapshot.manifest
  const plan = planWorkflowActionsSync(local.state.baseline, local.manifest, remote)
  return {
    appId: local.manifest.appId,
    client,
    directory: local.directory,
    local,
    remote,
    runtime: snapshot.runtime,
    summaries: snapshot.summaries,
    plan
  }
}

export function workflowActionsPlanError(plan: WorkflowActionsSyncPlan): Error | undefined {
  if (plan.errors.length > 0)
    return new Error(`Workflow action configuration cannot be pushed:\n- ${plan.errors.join('\n- ')}`)
  if (plan.conflicts.length > 0) {
    return new Error(
      `Workflow action configuration conflicts with portal changes:\n- ${plan.conflicts.join('\n- ')}\n` +
        'Run `ghl app actions pull`, reapply the local changes, and retry.'
    )
  }
  return undefined
}
