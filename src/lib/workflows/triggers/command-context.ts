import { ApiClient, WorkflowTriggerSummary } from '../../api/client.js'
import { resolveApp } from '../../app/context.js'
import { readPullWorkspaceBinding } from '../../app/pull.js'
import { getConfig } from '../../config/environment.js'
import { workflowTriggerPrerequisiteErrors } from './contract.js'
import { fetchWorkflowTriggersSnapshot } from './service.js'
import { planWorkflowTriggersSync, WorkflowTriggersSyncPlan } from './sync.js'
import { WorkflowTriggersManifest } from './manifest.js'
import { loadWorkflowTriggersWorkspace, WorkflowTriggersWorkspace } from './workspace.js'

export interface WorkflowTriggersRemoteContext {
  appId: string
  client: ApiClient
  directory?: string
}

export interface WorkflowTriggersSyncContext extends WorkflowTriggersRemoteContext {
  directory: string
  local: WorkflowTriggersWorkspace
  remote: WorkflowTriggersManifest
  runtime: WorkflowTriggersManifest
  summaries: WorkflowTriggerSummary[]
  plan: WorkflowTriggersSyncPlan
}

export async function loadWorkflowTriggersRemoteContext(options: {
  appId?: string
  directory?: string
  requireWorkspaceMatch?: boolean
}): Promise<WorkflowTriggersRemoteContext> {
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
    : binding?.appId ?? (await resolveApp(client, config)).appId
  return {
    appId,
    client,
    ...(binding && binding.appId === appId ? { directory: binding.directory } : {})
  }
}

export async function loadWorkflowTriggersSyncContext(
  directory: string,
  options: { requirePrerequisites?: boolean } = {}
): Promise<WorkflowTriggersSyncContext> {
  const local = await loadWorkflowTriggersWorkspace(directory)
  if (options.requirePrerequisites) {
    const errors = workflowTriggerPrerequisiteErrors({
      triggerCount: local.manifest.triggers.length,
      allowedScopes: local.allowedScopes,
      redirectUris: local.redirectUris,
      clientKeyCount: local.clientKeyCount,
      userTypes: local.userTypes
    })
    if (errors.length > 0) {
      throw new Error(`Workflow trigger prerequisites are not satisfied:\n- ${errors.join('\n- ')}`)
    }
  }
  const config = getConfig()
  const client = new ApiClient(config)
  await client.init()
  const snapshot = await fetchWorkflowTriggersSnapshot(client, local.manifest.appId)
  const remote = snapshot.manifest
  const plan = planWorkflowTriggersSync(local.state.baseline, local.manifest, remote)
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

export function workflowTriggersPlanError(plan: WorkflowTriggersSyncPlan): Error | undefined {
  if (plan.errors.length > 0) return new Error(`Workflow trigger configuration cannot be pushed:\n- ${plan.errors.join('\n- ')}`)
  if (plan.conflicts.length > 0) {
    return new Error(
      `Workflow trigger configuration conflicts with portal changes:\n- ${plan.conflicts.join('\n- ')}\n` +
        'Run `ghl app triggers pull`, reapply the local changes, and retry.'
    )
  }
  return undefined
}
