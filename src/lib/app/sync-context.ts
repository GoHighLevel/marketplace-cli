import { ApiClient, type AppVersion } from '../api/client.js'
import { sanitizeTerminalText } from '../api/response.js'
import { buildAppFiles } from './manifest.js'
import { readLocalAppWorkspace, type LocalAppWorkspace } from './local-workspace.js'
import { loadAppVersionForExport } from './pull.js'
import { createAppSyncPlan, type AppSyncPlan, validateLocalAppWorkspace } from './sync.js'
import { type CliConfig, getConfig } from '../config/environment.js'

export interface RemoteAppSyncContext {
  client: ApiClient
  config: CliConfig
  local: ValidatedLocalAppWorkspace
  remoteVersion: AppVersion
  plan: AppSyncPlan
}

export interface ValidatedLocalAppWorkspace extends LocalAppWorkspace {
  validation: ReturnType<typeof validateLocalAppWorkspace>
}

export function validationError(errors: string[]): Error {
  return new Error(
    `App workspace validation failed:\n- ${errors.map(error => sanitizeTerminalText(error, 1000)).join('\n- ')}`
  )
}

export async function loadValidatedLocalWorkspace(directory: string): Promise<ValidatedLocalAppWorkspace> {
  const local = await readLocalAppWorkspace(directory)
  const validation = validateLocalAppWorkspace(local.files, local.state)
  if (validation.errors.length > 0) throw validationError(validation.errors)
  return { ...local, validation }
}

export async function loadRemoteAppSyncContext(directory: string): Promise<RemoteAppSyncContext> {
  const local = await loadValidatedLocalWorkspace(directory)
  const config = getConfig()
  const client = new ApiClient(config)
  await client.init()
  const remoteVersion = await loadAppVersionForExport(client, local.files.app.appId, local.files.app.versionId)
  const plan = createAppSyncPlan(local.files, local.state, buildAppFiles(remoteVersion))
  return { client, config, local, remoteVersion, plan }
}
