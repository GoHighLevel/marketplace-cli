import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildPullFilesOutput,
  loadAppVersionForExport,
  readPullWorkspaceBinding,
  resolvePullWorkspaceBinding,
  resolveVersionId
} from '../../../src/lib/app/pull.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-app-pull-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('pull workspace binding', () => {
  it('discovers the app and version from a manifest in the current directory', async () => {
    const manifest = {
      schemaVersion: 1,
      appId: 'app-1',
      versionId: 'version-1',
      basicInfo: { name: 'Acme App' }
    }
    await fs.writeFile(path.join(root, 'ghl-app.json'), JSON.stringify(manifest))

    await expect(readPullWorkspaceBinding(root)).resolves.toEqual({
      directory: root,
      appId: 'app-1',
      versionId: 'version-1',
      name: 'Acme App'
    })
  })

  it('discovers the enclosing app workspace from any nested directory', async () => {
    await fs.writeFile(
      path.join(root, 'ghl-app.json'),
      JSON.stringify({ appId: 'app-1', versionId: 'version-1', basicInfo: { name: 'Acme App' } })
    )
    const nested = path.join(root, 'src', 'modules', 'workflows', 'actions')
    await fs.mkdir(nested, { recursive: true })

    await expect(readPullWorkspaceBinding(nested)).resolves.toMatchObject({
      directory: root,
      appId: 'app-1',
      versionId: 'version-1'
    })
  })

  it('returns no binding when the current directory is not an app workspace', async () => {
    await expect(readPullWorkspaceBinding(root)).resolves.toBeUndefined()
  })

  it.each([
    [{ versionId: 'version-1' }, /appId/i],
    [{ appId: 'app-1' }, /versionId/i],
    [{ appId: ' ', versionId: 'version-1' }, /appId/i],
    [{ appId: 'app-1', versionId: '' }, /versionId/i]
  ])('rejects an invalid local manifest binding %#', async (manifest, expectedMessage) => {
    await fs.writeFile(path.join(root, 'ghl-app.json'), JSON.stringify(manifest))

    await expect(readPullWorkspaceBinding(root)).rejects.toThrow(expectedMessage)
  })

  it('rejects a symlinked manifest', async () => {
    const outside = path.join(root, 'outside.json')
    await fs.writeFile(outside, JSON.stringify({ appId: 'app-1', versionId: 'version-1' }))
    await fs.symlink(outside, path.join(root, 'ghl-app.json'))

    await expect(readPullWorkspaceBinding(root)).rejects.toThrow(/symbolic link/i)
  })

  it('uses the local binding and prevents pulling another app into that workspace', () => {
    const binding = {
      directory: root,
      appId: 'app-1',
      versionId: 'version-1',
      name: 'Acme App'
    }

    expect(resolvePullWorkspaceBinding(binding)).toEqual(binding)
    expect(resolvePullWorkspaceBinding(binding, 'app-1')).toEqual(binding)
    expect(() => resolvePullWorkspaceBinding(binding, 'other-app')).toThrow(/belongs to app "app-1".*other-app/i)
  })
})

describe('resolveVersionId', () => {
  const versions = [
    { _id: 'draft-id', version: '1.2.0', status: 'draft' },
    { _id: 'live-id', version: '1.1.0', status: 'live' }
  ]

  it('uses the selected version by default and accepts an id or semantic version', () => {
    expect(resolveVersionId(versions, undefined, 'draft-id')).toBe('draft-id')
    expect(resolveVersionId(versions, 'live-id', 'draft-id')).toBe('live-id')
    expect(resolveVersionId(versions, '1.1.0', 'draft-id')).toBe('live-id')
  })

  it('fails with available values when the requested or selected version is unavailable', () => {
    expect(() => resolveVersionId(versions, '9.9.9', 'draft-id')).toThrow(/9\.9\.9.*1\.2\.0.*1\.1\.0/i)
    expect(() => resolveVersionId(versions, undefined, 'missing-id')).toThrow(/selected version.*no longer available/i)
  })
})

describe('loadAppVersionForExport', () => {
  it('loads only the version and rejects mismatched app data', async () => {
    const client = {
      getVersion: vi.fn().mockResolvedValue({ _id: 'version-1', appId: 'app-1', name: 'Acme' }),
      getBillingPlans: vi.fn().mockResolvedValue([{ _id: 'plan-1', name: 'Growth' }])
    }

    await expect(loadAppVersionForExport(client, 'app-1', 'version-1')).resolves.toEqual({
      _id: 'version-1',
      appId: 'app-1',
      name: 'Acme'
    })
    expect(client.getVersion).toHaveBeenCalledWith('app-1', 'version-1')
    expect(client.getBillingPlans).not.toHaveBeenCalled()

    client.getVersion.mockResolvedValueOnce({ _id: 'version-1', appId: 'other-app', name: 'Acme' })
    await expect(loadAppVersionForExport(client, 'app-1', 'version-1')).rejects.toThrow(/returned app "other-app"/i)
  })
})

describe('buildPullFilesOutput', () => {
  it('keeps every component state and guide path under an unambiguous key', () => {
    expect(buildPullFilesOutput({
      app: { directory: root, appFile: 'ghl-app.json', stateFile: '.ghl/state.json' },
      actions: {
        actionDirectory: 'actions', actionFiles: ['action.json'], codeDirectory: 'code', codeFiles: [],
        guideFile: 'actions.md', stateFile: '.ghl/workflow-actions-state.json'
      },
      triggers: {
        triggerDirectory: 'triggers', triggerFiles: ['trigger.json'],
        triggerGuideFile: 'triggers.md', triggerStateFile: '.ghl/workflow-triggers-state.json'
      },
      billing: {
        billingDirectory: 'billing', subscriptionFile: 'subscription.json', usageFile: 'usage-based.json',
        guideFile: 'billing.md', stateFile: '.ghl/billing-state.json'
      }
    })).toMatchObject({
      stateFile: '.ghl/state.json',
      actionGuideFile: 'actions.md',
      workflowActionStateFile: '.ghl/workflow-actions-state.json',
      triggerGuideFile: 'triggers.md',
      triggerStateFile: '.ghl/workflow-triggers-state.json',
      billingGuideFile: 'billing.md',
      billingStateFile: '.ghl/billing-state.json'
    })
  })
})
