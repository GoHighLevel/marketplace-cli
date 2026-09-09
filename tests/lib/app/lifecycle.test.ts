import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshAppWorkspaceLifecycle } from '../../../src/lib/app/lifecycle.js'
import { JSON_SCHEMA_REFERENCES } from '../../../src/lib/app/json-schema.js'
import { readJsonFile } from '../../../src/lib/shared/json-file.js'
import { AppManifest, WebhookManifest } from '../../../src/lib/app/manifest.js'
import { WorkspaceState, writeAppWorkspace } from '../../../src/lib/app/workspace.js'
import { completeAppVersion } from '../../helpers/app-files.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-app-lifecycle-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('refreshAppWorkspaceLifecycle', () => {
  it('refreshes server-owned lifecycle fields without overwriting pending local edits', async () => {
    const directory = path.join(root, 'acme')
    const workspace = await writeAppWorkspace({ directory, version: completeAppVersion() })
    const local = (await readJsonFile<AppManifest>(workspace.appFile))!
    local.basicInfo.tagline = 'Pending local tagline'
    await fs.writeFile(workspace.appFile, JSON.stringify(local, null, 2) + '\n')
    const nestedDirectory = path.join(directory, 'src', 'custom')
    await fs.mkdir(nestedDirectory, { recursive: true })
    const client = {
      listVersions: vi.fn().mockResolvedValue([
        { _id: 'version-1', appId: 'app-1', version: '1.1.0', status: 'review' }
      ]),
      getVersion: vi.fn().mockResolvedValue(
        completeAppVersion({ version: '1.1.0', status: 'review', tagline: 'Remote tagline' })
      )
    }

    const refreshed = await refreshAppWorkspaceLifecycle(
      nestedDirectory,
      client,
      'app-1',
      'version-1',
      '1.1.0'
    )

    expect(refreshed).toMatchObject({ directory, version: { _id: 'version-1', status: 'review' } })
    expect(client.listVersions).toHaveBeenCalledWith('app-1')
    expect(client.getVersion).toHaveBeenCalledWith('app-1', 'version-1')
    await expect(readJsonFile<AppManifest & { $schema: string }>(workspace.appFile)).resolves.toMatchObject({
      $schema: JSON_SCHEMA_REFERENCES.app,
      version: '1.1.0',
      status: 'review',
      basicInfo: { tagline: 'Pending local tagline' }
    })
    await expect(readJsonFile<WorkspaceState>(workspace.stateFile)).resolves.toMatchObject({
      baseline: {
        app: {
          version: '1.1.0',
          status: 'review',
          basicInfo: { tagline: completeAppVersion().tagline }
        }
      }
    })
  })

  it('does not call the API when the current directory is not the target app workspace', async () => {
    const directory = path.join(root, 'other-app')
    await writeAppWorkspace({
      directory,
      version: completeAppVersion({ _id: 'other-version', appId: 'other-app' })
    })
    const client = { listVersions: vi.fn(), getVersion: vi.fn() }

    await expect(
      refreshAppWorkspaceLifecycle(directory, client, 'app-1', 'version-1', '1.1.0')
    ).resolves.toBeUndefined()
    expect(client.listVersions).not.toHaveBeenCalled()
    expect(client.getVersion).not.toHaveBeenCalled()
  })

  it('follows a promoted live version while preserving pending local edits', async () => {
    const directory = path.join(root, 'acme')
    const workspace = await writeAppWorkspace({ directory, version: completeAppVersion() })
    const local = (await readJsonFile<AppManifest>(workspace.appFile))!
    local.basicInfo.tagline = 'Pending local tagline'
    await fs.writeFile(workspace.appFile, JSON.stringify(local, null, 2) + '\n')
    const client = {
      listVersions: vi.fn().mockResolvedValue([
        { _id: 'live-version', appId: 'app-1', version: '1.0.1', status: 'live' }
      ]),
      getVersion: vi.fn().mockResolvedValue(
        completeAppVersion({
          _id: 'live-version',
          createdAt: '2026-08-31T10:00:00.000Z',
          version: '1.0.1',
          status: 'live'
        })
      )
    }

    const refreshed = await refreshAppWorkspaceLifecycle(directory, client, 'app-1', 'version-1', '1.0.1')

    expect(refreshed).toMatchObject({ directory, version: { _id: 'live-version', status: 'live' } })
    await expect(readJsonFile<AppManifest>(workspace.appFile)).resolves.toMatchObject({
      versionId: 'live-version',
      createdAt: '2026-08-31T10:00:00.000Z',
      version: '1.0.1',
      status: 'live',
      basicInfo: { tagline: 'Pending local tagline' }
    })
    await expect(readJsonFile<WorkspaceState>(workspace.stateFile)).resolves.toMatchObject({
      versionId: 'live-version',
      baseline: {
        app: { versionId: 'live-version', version: '1.0.1', status: 'live' },
        webhooks: { versionId: 'live-version' }
      }
    })
    await expect(readJsonFile<WebhookManifest>(workspace.webhookFile!)).resolves.toMatchObject({
      appId: 'app-1',
      versionId: 'live-version'
    })
  })

  it('rejects a mismatched app response without changing local lifecycle fields', async () => {
    const directory = path.join(root, 'acme')
    const workspace = await writeAppWorkspace({ directory, version: completeAppVersion() })
    const client = {
      listVersions: vi.fn().mockResolvedValue([
        { _id: 'version-1', appId: 'app-1', version: '1.1.0', status: 'review' }
      ]),
      getVersion: vi.fn().mockResolvedValue(
        completeAppVersion({ appId: 'other-app', version: '1.1.0', status: 'review' })
      )
    }

    await expect(
      refreshAppWorkspaceLifecycle(directory, client, 'app-1', 'version-1', '1.1.0')
    ).rejects.toThrow(/other-app.*app-1/i)
    await expect(readJsonFile<AppManifest>(workspace.appFile)).resolves.toMatchObject({
      versionId: 'version-1',
      version: '1.0.0',
      status: 'draft'
    })
  })

  it('fails closed when the expected published version is absent', async () => {
    const directory = path.join(root, 'acme')
    const workspace = await writeAppWorkspace({ directory, version: completeAppVersion() })
    const client = {
      listVersions: vi.fn().mockResolvedValue([
        { _id: 'version-1', appId: 'app-1', version: 'draft', status: 'draft' }
      ]),
      getVersion: vi.fn()
    }

    await expect(
      refreshAppWorkspaceLifecycle(directory, client, 'app-1', 'version-1', '1.1.0')
    ).rejects.toThrow(/version "1\.1\.0".*not found/i)
    expect(client.getVersion).not.toHaveBeenCalled()
    await expect(readJsonFile<AppManifest>(workspace.appFile)).resolves.toMatchObject({
      versionId: 'version-1',
      version: '1.0.0',
      status: 'draft'
    })
  })
})
