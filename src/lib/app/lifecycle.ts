import { errorMessage } from '../shared/errors.js'
import { type AppVersion } from '../api/client.js'
import { writeJsonFileAtomic } from '../shared/json-file.js'
import { readLocalAppWorkspace } from './local-workspace.js'
import { readPullWorkspaceBinding } from './pull.js'
import { withJsonSchemaReference, writeJsonSchemaWorkspace } from './json-schema.js'

export interface AppLifecycleClient {
  listVersions(appId: string): Promise<Array<{ _id: string; version?: string }>>
  getVersion(appId: string, versionId: string): Promise<AppVersion>
}

export interface AppLifecycleRefresh {
  directory: string
  version: AppVersion
}

function requireLifecycleValue(value: string | undefined, field: 'status' | 'version'): string {
  if (!value || value.trim() !== value) throw new Error(`App version API did not return a valid ${field}.`)
  return value
}

export async function refreshAppWorkspaceLifecycle(
  inputDirectory: string,
  client: AppLifecycleClient,
  appId: string,
  versionId: string,
  expectedVersion: string
): Promise<AppLifecycleRefresh | undefined> {
  const binding = await readPullWorkspaceBinding(inputDirectory)
  if (!binding || binding.appId !== appId || binding.versionId !== versionId) return undefined

  const matches = (await client.listVersions(appId)).filter(candidate => candidate.version === expectedVersion)
  if (matches.length === 0) {
    throw new Error(`Version "${expectedVersion}" was not found after the API completed.`)
  }
  if (matches.length > 1) {
    throw new Error(`Version "${expectedVersion}" is ambiguous because the API returned multiple matches.`)
  }

  const remote = await client.getVersion(appId, matches[0]._id)
  if (remote._id !== matches[0]._id) {
    throw new Error(`App version API returned version "${remote._id}" instead of "${matches[0]._id}".`)
  }
  if (remote.appId !== undefined && remote.appId !== appId) {
    throw new Error(`App version API returned app "${remote.appId}" instead of "${appId}".`)
  }

  const workspace = await readLocalAppWorkspace(binding.directory)
  const originalApp = structuredClone(workspace.files.app)
  const originalWebhooks = structuredClone(workspace.files.webhooks)
  const originalState = structuredClone(workspace.state)
  const version = requireLifecycleValue(remote.version, 'version')
  const status = requireLifecycleValue(remote.status, 'status')
  if (version !== expectedVersion) {
    throw new Error(`App version API returned version "${version}" instead of "${expectedVersion}".`)
  }

  if (remote._id !== versionId) {
    workspace.files.app.versionId = remote._id
    workspace.files.webhooks.versionId = remote._id
    workspace.state.versionId = remote._id
    workspace.state.baseline.app.versionId = remote._id
    workspace.state.baseline.webhooks.versionId = remote._id
    if (remote.createdAt) {
      workspace.files.app.createdAt = remote.createdAt
      workspace.state.baseline.app.createdAt = remote.createdAt
    } else {
      delete workspace.files.app.createdAt
      delete workspace.state.baseline.app.createdAt
    }
  }
  workspace.files.app.version = version
  workspace.files.app.status = status
  workspace.state.baseline.app.version = version
  workspace.state.baseline.app.status = status

  const managedWrites: Array<[string, unknown, unknown, number]> = [
    [
      workspace.appFile,
      withJsonSchemaReference(workspace.files.app, 'app'),
      withJsonSchemaReference(originalApp, 'app'),
      0o644
    ],
    [workspace.stateFile, workspace.state, originalState, 0o600]
  ]
  if (workspace.webhookFileExists) {
    managedWrites.push([
      workspace.webhookFile,
      withJsonSchemaReference(workspace.files.webhooks, 'webhooks'),
      withJsonSchemaReference(originalWebhooks, 'webhooks'),
      0o644
    ])
  }

  await writeJsonSchemaWorkspace(workspace.directory)
  const writes = await Promise.allSettled(
    managedWrites.map(([file, current, , mode]) => writeJsonFileAtomic(file, current, mode))
  )
  const failure = writes.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    const restored = await Promise.allSettled(
      managedWrites.map(([file, , original, mode]) => writeJsonFileAtomic(file, original, mode))
    )
    const reason = errorMessage(failure.reason, 'Unknown write failure.')
    if (restored.some(result => result.status === 'rejected')) {
      throw new Error(
        `Local lifecycle synchronization failed and rollback was incomplete: ${reason} ` +
          'Run `ghl app pull` before making more changes.'
      )
    }
    throw failure.reason
  }

  return { directory: binding.directory, version: remote }
}
