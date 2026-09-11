import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ApiClient, type AppVersion } from '../../../src/lib/api/client.js'
import { buildAppFiles, type WebhookManifest } from '../../../src/lib/app/manifest.js'
import { JSON_SCHEMA_REFERENCES } from '../../../src/lib/app/json-schema.js'
import { readLocalAppWorkspace } from '../../../src/lib/app/local-workspace.js'
import { createAppSyncPlan, validateLocalAppWorkspace } from '../../../src/lib/app/sync.js'
import { type CliConfig } from '../../../src/lib/config/environment.js'
import { readJsonFile, writeJsonFileAtomic } from '../../../src/lib/shared/json-file.js'
import {
  applyWebhookWorkspaceMutation,
  type WebhookMutationRuntime,
  type WebhookWorkspaceMutationContext
} from '../../../src/lib/webhooks/workspace-mutation.js'
import { writeAppWorkspace } from '../../../src/lib/app/workspace.js'
import { cloneAppFiles, completeAppVersion } from '../../helpers/app-files.js'

const CONFIG: CliConfig = {
  portalUrl: 'https://portal.example.com',
  apiUrl: 'https://api.example.com',
  oauthUrl: 'https://oauth.example.com',
  workflowsUrl: 'https://workflows.example.com',
  configDir: '/tmp/ghl-cli-webhook-mutation-config'
}

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-webhook-mutation-'))
})

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true })
})

async function mutationContext(
  initialVersion: AppVersion = completeAppVersion(),
  remoteVersion: AppVersion = initialVersion
): Promise<WebhookWorkspaceMutationContext> {
  const directory = path.join(root, 'app')
  await writeAppWorkspace({ directory, version: initialVersion })
  const local = await readLocalAppWorkspace(directory)
  const remoteFiles = buildAppFiles(remoteVersion)
  return {
    client: {} as ApiClient,
    config: CONFIG,
    local: { ...local, validation: validateLocalAppWorkspace(local.files, local.state) },
    remoteVersion,
    remoteFiles,
    plan: createAppSyncPlan(local.files, local.state, remoteFiles)
  }
}

function configuration(version: AppVersion): Pick<WebhookManifest, 'webhookUrl' | 'subscribedEvents'> {
  const webhooks = buildAppFiles(version).webhooks
  return { webhookUrl: webhooks.webhookUrl, subscribedEvents: webhooks.subscribedEvents }
}

function runtime(overrides: Partial<WebhookMutationRuntime> = {}): Partial<WebhookMutationRuntime> {
  return {
    validateDynamicConfiguration: vi.fn().mockResolvedValue([]),
    persistSelection: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('applyWebhookWorkspaceMutation', () => {
  it('writes webhook JSON before the API call and advances the baseline only after verification', async () => {
    const context = await mutationContext()
    const desiredVersion = completeAppVersion({ subscribedEvents: [{ name: 'ContactCreate' }] })
    const executePlan = vi.fn().mockImplementation(async () => {
      const local = await readJsonFile<WebhookManifest>(context.local.webhookFile)
      const state = await readJsonFile<{ baseline: { webhooks: WebhookManifest } }>(context.local.stateFile)
      expect(local).toMatchObject({ $schema: JSON_SCHEMA_REFERENCES.webhooks })
      expect(local?.subscribedEvents).toEqual([{ name: 'ContactCreate' }])
      expect(state?.baseline.webhooks.subscribedEvents).toHaveLength(2)
      return { appliedSections: ['authSettings'] as const, versionId: 'version-1' }
    })

    const result = await applyWebhookWorkspaceMutation(
      context,
      configuration(desiredVersion),
      runtime({
        executePlan,
        loadVersion: vi.fn().mockResolvedValue(desiredVersion)
      })
    )

    expect(result).toMatchObject({ applied: true, recovered: false, versionId: 'version-1' })
    const refreshed = await readLocalAppWorkspace(context.local.directory)
    expect(refreshed.files.webhooks.subscribedEvents).toEqual([{ name: 'ContactCreate' }])
    expect(refreshed.state.baseline.webhooks.subscribedEvents).toEqual([{ name: 'ContactCreate' }])
  })

  it('restores the original JSON when the API fails and remote state is confirmed unchanged', async () => {
    const context = await mutationContext()
    const desiredVersion = completeAppVersion({ subscribedEvents: [{ name: 'ContactCreate' }] })

    await expect(
      applyWebhookWorkspaceMutation(
        context,
        configuration(desiredVersion),
        runtime({
          executePlan: vi.fn().mockRejectedValue(new Error('request rejected')),
          loadVersion: vi.fn().mockResolvedValue(context.remoteVersion),
          loadLatestVersion: vi.fn().mockResolvedValue(context.remoteVersion)
        })
      )
    ).rejects.toThrow(/request rejected.*restored/i)

    const restored = await readLocalAppWorkspace(context.local.directory)
    expect(restored.files.webhooks).toEqual(context.local.files.webhooks)
    expect(restored.state).toEqual(context.local.state)
  })

  it('restores an absent webhook directory when the first subscription fails', async () => {
    const initialVersion = completeAppVersion({ webhookUrl: '', subscribedEvents: [] })
    const context = await mutationContext(initialVersion)
    const desiredVersion = completeAppVersion({
      webhookUrl: 'https://api.acme.example.com/webhooks',
      subscribedEvents: [{ name: 'ContactCreate' }]
    })

    await expect(
      applyWebhookWorkspaceMutation(
        context,
        configuration(desiredVersion),
        runtime({
          executePlan: vi.fn().mockRejectedValue(new Error('request rejected')),
          loadVersion: vi.fn().mockResolvedValue(initialVersion),
          loadLatestVersion: vi.fn().mockResolvedValue(initialVersion)
        })
      )
    ).rejects.toThrow(/request rejected.*restored/i)

    await expect(fs.stat(path.dirname(context.local.webhookFile))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readLocalAppWorkspace(context.local.directory)).files.webhooks.subscribedEvents).toEqual([])
  })

  it('keeps a pending local change when the remote result cannot be determined', async () => {
    const context = await mutationContext()
    const desiredVersion = completeAppVersion({ subscribedEvents: [{ name: 'ContactCreate' }] })

    await expect(
      applyWebhookWorkspaceMutation(
        context,
        configuration(desiredVersion),
        runtime({
          executePlan: vi.fn().mockRejectedValue(new Error('connection reset')),
          loadVersion: vi.fn().mockRejectedValue(new Error('offline')),
          loadLatestVersion: vi.fn().mockRejectedValue(new Error('offline'))
        })
      )
    ).rejects.toThrow(/could not be verified.*kept as a pending change/i)

    const pending = await readLocalAppWorkspace(context.local.directory)
    expect(pending.files.webhooks.subscribedEvents).toEqual([{ name: 'ContactCreate' }])
    expect(pending.state).toEqual(context.local.state)
  })

  it('recovers a successful remote mutation whose API response was lost', async () => {
    const context = await mutationContext()
    const desiredVersion = completeAppVersion({
      _id: 'draft-2',
      subscribedEvents: [{ name: 'ContactCreate' }]
    })

    const result = await applyWebhookWorkspaceMutation(
      context,
      configuration(desiredVersion),
      runtime({
        executePlan: vi.fn().mockRejectedValue(new Error('response lost')),
        loadVersion: vi.fn().mockResolvedValue(context.remoteVersion),
        loadLatestVersion: vi.fn().mockResolvedValue(desiredVersion)
      })
    )

    expect(result).toMatchObject({ applied: true, recovered: true, versionId: 'draft-2' })
    const refreshed = await readLocalAppWorkspace(context.local.directory)
    expect(refreshed.files.webhooks.subscribedEvents).toEqual([{ name: 'ContactCreate' }])
    expect(refreshed.state.versionId).toBe('draft-2')
  })

  it('absorbs remote-only webhook changes without making another API call', async () => {
    const initialVersion = completeAppVersion({
      subscribedEvents: [{ name: 'ContactCreate' }, { name: 'ContactDndUpdate' }]
    })
    const remoteVersion = completeAppVersion({ subscribedEvents: [{ name: 'ContactCreate' }] })
    const context = await mutationContext(initialVersion, remoteVersion)
    const executePlan = vi.fn()

    const result = await applyWebhookWorkspaceMutation(context, configuration(remoteVersion), runtime({ executePlan }))

    expect(result).toMatchObject({ applied: false, recovered: false })
    expect(executePlan).not.toHaveBeenCalled()
    const refreshed = await readLocalAppWorkspace(context.local.directory)
    expect(refreshed.files.webhooks.subscribedEvents).toEqual([{ name: 'ContactCreate' }])
    expect(refreshed.state.baseline.webhooks.subscribedEvents).toEqual([{ name: 'ContactCreate' }])
  })

  it('refuses to combine a convenience command with unrelated pending local changes', async () => {
    const context = await mutationContext()
    const app = cloneAppFiles(context.local.files).app
    app.basicInfo.tagline = 'Pending local tagline change'
    await writeJsonFileAtomic(context.local.appFile, app, 0o644)
    const local = await readLocalAppWorkspace(context.local.directory)
    context.local = { ...local, validation: validateLocalAppWorkspace(local.files, local.state) }
    context.plan = createAppSyncPlan(local.files, local.state, context.remoteFiles)
    const executePlan = vi.fn()

    await expect(
      applyWebhookWorkspaceMutation(context, configuration(context.remoteVersion), runtime({ executePlan }))
    ).rejects.toThrow(/pending local app changes.*basicInfo\.tagline.*app push/i)

    expect(executePlan).not.toHaveBeenCalled()
    const unchanged = await readLocalAppWorkspace(context.local.directory)
    expect(unchanged.files.webhooks).toEqual(context.local.files.webhooks)
  })
})
