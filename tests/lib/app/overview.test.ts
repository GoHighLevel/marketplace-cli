import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ApiClient } from '../../../src/lib/api/client.js'
import { isEditableStatus, loadAppOverview, resolveTargetApp } from '../../../src/lib/app/overview.js'
import { type CliConfig } from '../../../src/lib/config/environment.js'
import { saveSelectedApp } from '../../../src/lib/config/selection-store.js'
import { completeAppVersion } from '../../helpers/app-files.js'

let dir: string
let config: CliConfig

function fakeClient(overrides: Partial<Record<keyof ApiClient, unknown>> = {}): ApiClient {
  return {
    activeProfileName: 'default',
    listApps: async () => ({ apps: [{ _id: 'version-1', appId: 'app-1', name: 'Acme CRM' }], totalCount: 1 }),
    getLatestVersion: async () => completeAppVersion(),
    getVersion: async () => completeAppVersion(),
    listVersions: async () => [{ _id: 'version-1', version: '1.0.0', status: 'draft' }],
    listWorkflowActionSummaries: async () => [],
    listWorkflowTriggerSummaries: async () => [],
    preSubmitValidation: vi.fn(async () => ({ success: true, mandatoryFields: { logo: false } })),
    analyzeVersion: vi.fn(async () => ({ suggestedVersion: '1.1.0', latestLiveVersion: '1.0.0' })),
    ...overrides
  } as unknown as ApiClient
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-overview-'))
  config = { portalUrl: '', apiUrl: '', oauthUrl: '', workflowsUrl: '', configDir: dir }
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('resolveTargetApp', () => {
  it('prefers the app id, then the workspace at the directory, then the selected app', async () => {
    const workspace = path.join(dir, 'acme')
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'ghl-app.json'),
      JSON.stringify({ appId: 'app-ws', versionId: 'version-ws', basicInfo: { name: 'Workspace App' } })
    )
    await saveSelectedApp(dir, 'default', { appId: 'app-selected', versionId: 'version-selected' })
    const client = fakeClient()

    await expect(resolveTargetApp(client, config, { appId: 'app-1', directory: workspace })).resolves.toMatchObject({
      appId: 'app-1',
      versionId: 'version-1'
    })
    await expect(resolveTargetApp(client, config, { directory: path.join(workspace, 'src') })).resolves.toEqual({
      appId: 'app-ws',
      versionId: 'version-ws',
      name: 'Workspace App'
    })
    await expect(resolveTargetApp(client, config, { directory: dir })).resolves.toMatchObject({ appId: 'app-selected' })
  })

  it('explains how to name an app when none can be resolved', async () => {
    await expect(resolveTargetApp(fakeClient(), config, {})).rejects.toMatchObject({ code: 'NO_APP' })
  })
})

describe('loadAppOverview', () => {
  it('adds publish readiness and the next version for an editable version only', async () => {
    const draft = await loadAppOverview(fakeClient(), config, { appId: 'app-1' })
    expect(draft).toMatchObject({
      readiness: { value: { mandatoryFields: { logo: false } } },
      analysis: { value: { suggestedVersion: '1.1.0' } }
    })

    const live = fakeClient({ getVersion: async () => completeAppVersion({ status: 'live' }) })
    const overview = await loadAppOverview(live, config, { appId: 'app-1' })
    expect(overview).not.toHaveProperty('readiness')
    expect(live.preSubmitValidation).not.toHaveBeenCalled()
  })

  it('keeps the overview when a secondary read fails', async () => {
    const client = fakeClient({
      listWorkflowActionSummaries: async () => {
        throw new Error('registry down')
      }
    })
    await expect(loadAppOverview(client, config, { appId: 'app-1' })).resolves.toMatchObject({
      actions: { error: 'registry down' },
      triggers: { value: [] }
    })
  })

  it('treats draft and disapproved versions as editable', () => {
    expect(['draft', 'Disapproved', 'live', undefined].map(isEditableStatus)).toEqual([true, true, false, false])
  })
})
