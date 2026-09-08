import { ApiClient, AppVersion } from '../api/client.js'
import { resolveApp } from '../app/context.js'
import { readPullWorkspaceBinding } from '../app/pull.js'
import { getConfig } from '../config/environment.js'
import { validateExternalAuthManifest } from './schema.js'
import { ExternalAuthCapabilityLocks } from './manifest.js'
import {
  ExternalAuthSnapshot,
  fetchExternalAuthSnapshot,
  resolveExternalAuthLocks
} from './service.js'
import { ExternalAuthSyncPlan, planExternalAuthSync } from './sync.js'
import { ExternalAuthWorkspace, loadExternalAuthWorkspace } from './workspace.js'

export interface ExternalAuthRemoteContext {
  appId: string
  versionId: string
  client: ApiClient
  directory?: string
}

export interface ExternalAuthSyncContext extends ExternalAuthRemoteContext {
  directory: string
  local: ExternalAuthWorkspace
  remote: ExternalAuthSnapshot
  remoteVersion: AppVersion
  locks: ExternalAuthCapabilityLocks
  plan: ExternalAuthSyncPlan
}

export async function loadExternalAuthRemoteContext(options: {
  appId?: string
  directory?: string
  requireWorkspaceMatch?: boolean
}): Promise<ExternalAuthRemoteContext> {
  const directory = options.directory ?? process.cwd()
  const binding = await readPullWorkspaceBinding(directory)
  if (options.requireWorkspaceMatch && binding && options.appId && binding.appId !== options.appId) {
    throw new Error(`The workspace belongs to app "${binding.appId}", not "${options.appId}".`)
  }
  const config = getConfig()
  const client = new ApiClient(config)
  await client.init()
  const useWorkspace = Boolean(binding && (!options.appId || binding.appId === options.appId))
  if (useWorkspace && binding) {
    return {
      appId: binding.appId,
      versionId: binding.versionId,
      client,
      directory: binding.directory
    }
  }
  const selected = await resolveApp(client, config, options.appId)
  const versionId = selected.versionId || (await client.getLatestVersion(selected.appId))._id
  return { appId: selected.appId, versionId, client }
}

export async function loadExternalAuthSyncContext(directory: string): Promise<ExternalAuthSyncContext> {
  const local = await loadExternalAuthWorkspace(directory)
  const localErrors = validateExternalAuthManifest(local.manifest, local.state.capabilityLocks)
  if (localErrors.length > 0) {
    throw new Error(`External auth configuration is invalid:\n- ${localErrors.join('\n- ')}`)
  }

  const config = getConfig()
  const client = new ApiClient(config)
  await client.init()
  const [remote, remoteVersion] = await Promise.all([
    fetchExternalAuthSnapshot(client, local.app.appId, local.app.versionId),
    client.getVersion(local.app.appId, local.app.versionId)
  ])
  const locks = await resolveExternalAuthLocks(client, local.app.appId, {
    versionId: local.app.versionId,
    response: remote.raw
  })
  const plan = planExternalAuthSync(
    local.state.baseline,
    local.manifest,
    remote.manifest,
    { status: remoteVersion.status }
  )
  const errors = validateExternalAuthManifest(
    local.manifest,
    plan.localChanges.length > 0 ? locks : {}
  )
  if (errors.length > 0) {
    plan.errors = [...new Set([...plan.errors, ...errors])]
    plan.updateRequired = false
  }
  return {
    appId: local.app.appId,
    versionId: local.app.versionId,
    client,
    directory: local.directory,
    local,
    remote,
    remoteVersion,
    locks,
    plan
  }
}

export function externalAuthPlanError(plan: ExternalAuthSyncPlan): Error | undefined {
  if (plan.errors.length > 0) {
    return new Error(`External auth configuration cannot be pushed:\n- ${plan.errors.join('\n- ')}`)
  }
  if (plan.conflicts.length > 0) {
    return new Error(
      `External auth configuration conflicts with portal changes:\n- ${plan.conflicts.join('\n- ')}\n` +
        'Run `ghl app external-auth pull`, reapply the local changes, and retry.'
    )
  }
  return undefined
}
