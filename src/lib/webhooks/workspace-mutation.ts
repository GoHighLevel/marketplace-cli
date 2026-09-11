import path from 'node:path'

import { Flags } from '@oclif/core'

import { type ApiClient, type AppVersion } from '../api/client.js'
import { persistSelection } from '../app/context.js'
import { buildAppFiles, type AppFiles, type WebhookManifest } from '../app/manifest.js'
import { executeAppSyncPlan } from '../app/push.js'
import { type AuthCatalogSnapshot, validateDynamicAuthConfiguration } from '../app/push-preflight.js'
import { loadAppVersionForExport, readPullWorkspaceBinding } from '../app/pull.js'
import { loadRemoteAppSyncContext, type RemoteAppSyncContext, validationError } from '../app/sync-context.js'
import { createAppSyncPlan, type AppSyncPlan, validateSyncPlan, verifyAppliedChanges } from '../app/sync.js'
import { type CliConfig } from '../config/environment.js'
import { writeJsonFileAtomic } from '../shared/json-file.js'
import {
  type AppWorkspaceResult,
  hasWebhookConfiguration,
  type WorkspaceState,
  writeAppWorkspace
} from '../app/workspace.js'
import { removeEmptyDirectoryTree, removeRegularFileIfPresent } from '../shared/workspace-files.js'
import { withJsonSchemaReference, writeJsonSchemaWorkspace } from '../app/json-schema.js'

export interface WebhookWorkspaceMutationContext extends RemoteAppSyncContext {
  remoteFiles: AppFiles
  webhooksCatalog?: AuthCatalogSnapshot['webhooks']
}

export interface WebhookWorkspaceMutationResult {
  applied: boolean
  recovered: boolean
  versionId: string
  workspace: AppWorkspaceResult
}

export interface WebhookMutationRuntime {
  validateDynamicConfiguration(client: ApiClient, plan: AppSyncPlan, catalogs?: AuthCatalogSnapshot): Promise<string[]>
  executePlan(
    client: ApiClient,
    remoteVersion: AppVersion,
    plan: AppSyncPlan
  ): Promise<{
    appliedSections: AppSyncPlan['sections']
    versionId: string
  }>
  loadVersion(client: ApiClient, appId: string, versionId: string): Promise<AppVersion>
  loadLatestVersion(client: ApiClient, appId: string): Promise<AppVersion>
  writeWorkspace(options: { directory: string; version: AppVersion }): Promise<AppWorkspaceResult>
  persistSelection(
    client: ApiClient,
    config: CliConfig,
    app: { appId: string; versionId: string; name?: string }
  ): Promise<void>
  writeJson(filePath: string, data: unknown, mode?: number): Promise<void>
}

const DEFAULT_RUNTIME: WebhookMutationRuntime = {
  validateDynamicConfiguration: validateDynamicAuthConfiguration,
  executePlan: executeAppSyncPlan,
  loadVersion: loadAppVersionForExport,
  loadLatestVersion: async (client, appId) => {
    const version = await client.getLatestVersion(appId, false)
    if (version.appId !== undefined && version.appId !== appId) {
      throw new Error(`Latest app version API returned app "${version.appId}" instead of "${appId}".`)
    }
    return { ...version, appId }
  },
  writeWorkspace: writeAppWorkspace,
  persistSelection,
  writeJson: writeJsonFileAtomic
}

function runtimeWith(overrides: Partial<WebhookMutationRuntime>): WebhookMutationRuntime {
  return { ...DEFAULT_RUNTIME, ...overrides }
}

export function webhookWorkspaceFlags() {
  return {
    app: Flags.string({ description: 'Expected app id; must match the local workspace' }),
    directory: Flags.string({
      description: 'App workspace directory or a directory inside it (default: current directory)',
      default: '.'
    })
  }
}

export async function loadWebhookWorkspaceMutationContext(
  inputDirectory: string,
  expectedAppId?: string
): Promise<WebhookWorkspaceMutationContext> {
  const binding = await readPullWorkspaceBinding(inputDirectory)
  if (!binding) {
    throw new Error(
      'Webhook mutations require a local app workspace. Run the command inside an app folder or pass `--directory <app-folder>`.'
    )
  }
  if (expectedAppId && binding.appId !== expectedAppId) {
    throw new Error(`App workspace belongs to app "${binding.appId}", not "${expectedAppId}".`)
  }
  const context = await loadRemoteAppSyncContext(binding.directory)
  return { ...context, remoteFiles: buildAppFiles(context.remoteVersion) }
}

function workspaceState(files: AppFiles): WorkspaceState {
  return {
    schemaVersion: 1,
    appId: files.app.appId,
    versionId: files.app.versionId,
    baseline: structuredClone(files)
  }
}

function desiredFiles(
  context: WebhookWorkspaceMutationContext,
  configuration: Pick<WebhookManifest, 'webhookUrl' | 'subscribedEvents'>
): AppFiles {
  const files = structuredClone(context.remoteFiles)
  files.webhooks = {
    ...files.webhooks,
    webhookUrl: configuration.webhookUrl,
    subscribedEvents: structuredClone(configuration.subscribedEvents)
  }
  return files
}

function assertWorkspaceReady(context: WebhookWorkspaceMutationContext): void {
  const validation = validateSyncPlan(context.plan, context.remoteVersion)
  if (validation.errors.length > 0) throw validationError(validation.errors)
  if (context.plan.localChanges.length === 0) return
  const paths = context.plan.localChanges.map(change => change.path).join(', ')
  throw new Error(
    `Pending local app changes must be pushed before running a webhook convenience command: ${paths}. ` +
      'Run `ghl app diff` and `ghl app push` first.'
  )
}

function normalizedWebhooks(webhooks: WebhookManifest): unknown {
  return {
    webhookUrl: webhooks.webhookUrl.trim(),
    subscribedEvents: webhooks.subscribedEvents
      .map(event => ({ name: event.name, url: event.url?.trim() || null }))
      .sort((left, right) => left.name.localeCompare(right.name) || (left.url ?? '').localeCompare(right.url ?? ''))
  }
}

function sameWebhookConfiguration(left: WebhookManifest, right: WebhookManifest): boolean {
  return JSON.stringify(normalizedWebhooks(left)) === JSON.stringify(normalizedWebhooks(right))
}

async function writeDesiredWebhookConfiguration(
  context: WebhookWorkspaceMutationContext,
  webhooks: WebhookManifest,
  runtime: WebhookMutationRuntime
): Promise<void> {
  if (hasWebhookConfiguration(webhooks)) {
    await writeJsonSchemaWorkspace(context.local.directory)
    await runtime.writeJson(context.local.webhookFile, withJsonSchemaReference(webhooks, 'webhooks'), 0o644)
    return
  }
  await removeRegularFileIfPresent(context.local.webhookFile, 'Webhook manifest')
  await removeEmptyDirectoryTree(path.dirname(context.local.webhookFile), context.local.directory)
}

async function finalizeMutation(
  context: WebhookWorkspaceMutationContext,
  plan: AppSyncPlan,
  version: AppVersion,
  applied: boolean,
  recovered: boolean,
  runtime: WebhookMutationRuntime
): Promise<WebhookWorkspaceMutationResult> {
  const mismatches = verifyAppliedChanges(plan, buildAppFiles(version))
  if (mismatches.length > 0) {
    throw new Error(`Remote webhook verification failed for: ${mismatches.join(', ')}.`)
  }
  const workspace = await runtime.writeWorkspace({ directory: context.local.directory, version })
  const appId = String(version.appId ?? context.plan.appId)
  await runtime.persistSelection(context.client, context.config, {
    appId,
    versionId: version._id,
    ...(version.name ? { name: version.name } : {})
  })
  return { applied, recovered, versionId: version._id, workspace }
}

async function recoveryCandidates(
  context: WebhookWorkspaceMutationContext,
  runtime: WebhookMutationRuntime
): Promise<AppVersion[]> {
  const results = await Promise.allSettled([
    runtime.loadVersion(context.client, context.plan.appId, context.remoteVersion._id),
    runtime.loadLatestVersion(context.client, context.plan.appId)
  ])
  const versions = results.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
  const unique = new Map(versions.map(version => [version._id, version]))
  return [...unique.values()]
}

async function recoverFailedMutation(
  context: WebhookWorkspaceMutationContext,
  plan: AppSyncPlan,
  desired: AppFiles,
  failure: unknown,
  runtime: WebhookMutationRuntime
): Promise<WebhookWorkspaceMutationResult> {
  const reason = failure instanceof Error ? failure.message : 'The webhook API request failed.'
  const candidates = await recoveryCandidates(context, runtime)
  const applied = candidates.find(version => verifyAppliedChanges(plan, buildAppFiles(version)).length === 0)
  if (applied) {
    try {
      return await finalizeMutation(context, plan, applied, true, true, runtime)
    } catch (error) {
      const syncReason = error instanceof Error ? error.message : 'Local workspace synchronization failed.'
      throw new Error(
        `${reason} The remote webhook change was applied, but local synchronization failed: ${syncReason} ` +
          'The desired webhook JSON was retained; run `ghl app diff` and `ghl app push` to reconcile it.'
      )
    }
  }

  const unchanged = candidates.some(version =>
    sameWebhookConfiguration(buildAppFiles(version).webhooks, context.remoteFiles.webhooks)
  )
  if (unchanged) {
    await writeDesiredWebhookConfiguration(context, context.local.files.webhooks, runtime)
    throw new Error(`${reason} Remote webhook settings were unchanged, so the local webhook JSON was restored.`)
  }

  await writeDesiredWebhookConfiguration(context, desired.webhooks, runtime)
  throw new Error(
    `${reason} The remote result could not be verified, so the local webhook JSON was kept as a pending change. ` +
      'Run `ghl app diff` and `ghl app push` to retry safely.'
  )
}

export async function applyWebhookWorkspaceMutation(
  context: WebhookWorkspaceMutationContext,
  configuration: Pick<WebhookManifest, 'webhookUrl' | 'subscribedEvents'>,
  runtimeOverrides: Partial<WebhookMutationRuntime> = {}
): Promise<WebhookWorkspaceMutationResult> {
  assertWorkspaceReady(context)
  const runtime = runtimeWith(runtimeOverrides)
  const desired = desiredFiles(context, configuration)
  const plan = createAppSyncPlan(desired, workspaceState(context.remoteFiles), context.remoteFiles)
  const validation = validateSyncPlan(plan, context.remoteVersion)
  if (validation.errors.length > 0) throw validationError(validation.errors)
  if (plan.sections.some(section => section !== 'authSettings')) {
    throw new Error('Webhook mutation unexpectedly planned a non-webhook app section.')
  }
  const dynamicErrors = await runtime.validateDynamicConfiguration(
    context.client,
    plan,
    context.webhooksCatalog ? { webhooks: context.webhooksCatalog } : undefined
  )
  if (dynamicErrors.length > 0) throw validationError(dynamicErrors)

  await writeDesiredWebhookConfiguration(context, desired.webhooks, runtime)
  if (plan.localChanges.length === 0) {
    try {
      return await finalizeMutation(context, plan, context.remoteVersion, false, false, runtime)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Local workspace synchronization failed.'
      throw new Error(
        `Remote webhook settings already matched, but the local workspace could not be synchronized: ${reason}`
      )
    }
  }

  let versionId: string
  try {
    versionId = (await runtime.executePlan(context.client, context.remoteVersion, plan)).versionId
  } catch (error) {
    return recoverFailedMutation(context, plan, desired, error, runtime)
  }

  let version: AppVersion
  try {
    version = await runtime.loadVersion(context.client, context.plan.appId, versionId)
    return await finalizeMutation(context, plan, version, true, false, runtime)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Remote verification or local synchronization failed.'
    throw new Error(
      `The remote webhook update completed, but verification and local synchronization failed: ${reason} ` +
        'The desired webhook JSON was retained; run `ghl app diff` and `ghl app push` to reconcile it.'
    )
  }
}
