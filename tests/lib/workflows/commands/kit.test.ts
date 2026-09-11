import { Command, Config } from '@oclif/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { workflowResourceCommands } from '../../../../src/lib/workflows/commands/kit.js'
import { withVerificationMismatches } from '../../../../src/lib/workflows/commands/push.js'
import { loadWorkflowRemoteContext, loadWorkflowSyncContext } from '../../../../src/lib/workflows/shared/context.js'
import type * as ContextModule from '../../../../src/lib/workflows/shared/context.js'
import {
  type WorkflowResource,
  type WorkflowResourceDefinition,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../../../../src/lib/workflows/shared/resource.js'

vi.mock('../../../../src/lib/workflows/shared/context.js', async importOriginal => ({
  ...(await importOriginal<typeof ContextModule>()),
  loadWorkflowRemoteContext: vi.fn(),
  loadWorkflowSyncContext: vi.fn()
}))

interface FakeManifest {
  schemaVersion: 1
  appId: string
  items: WorkflowResourceDefinition[]
}

interface FakeWorkspace extends WorkflowResourceWorkspace<FakeManifest> {
  prerequisiteErrors: string[]
}

interface FakeFiles {
  itemDirectory: string
  itemFiles: string[]
  stateFile: string
}

interface FakeSummary {
  id: string
  name: string
  version: string
  status: string
}

type FakeResource = WorkflowResource<FakeManifest, WorkflowResourcePlan, FakeWorkspace, FakeFiles, FakeSummary>

const published: WorkflowResourceDefinition = {
  templateId: 'tpl-1',
  key: 'send_message',
  versions: [{ version: '1.0', status: 'published', info: { name: 'Send message' } }]
}

function manifest(items: WorkflowResourceDefinition[] = [published]): FakeManifest {
  return { schemaVersion: 1, appId: 'app-1', items }
}

function workspace(items?: WorkflowResourceDefinition[], prerequisiteErrors: string[] = []): FakeWorkspace {
  const current = manifest(items)
  return { directory: '/workspace', manifest: current, state: { baseline: current }, prerequisiteErrors }
}

function plan(overrides: Partial<WorkflowResourcePlan> = {}): WorkflowResourcePlan {
  return {
    appId: 'app-1',
    localChanges: [],
    remoteChanges: [],
    conflicts: [],
    errors: [],
    operations: [],
    ...overrides
  }
}

const files: FakeFiles = { itemDirectory: '/workspace/items', itemFiles: ['/workspace/items/a.json'], stateFile: '/s' }
const client = {} as Parameters<FakeResource['fetchSnapshot']>[0]

function fakeResource(overrides: Partial<FakeResource> = {}): FakeResource {
  return {
    singular: 'item',
    plural: 'items',
    label: 'Fake item',
    items: current => current.items,
    withScaffold: (current, name, key) => ({
      ...current,
      items: [...current.items, { key, versions: [{ version: '1.0', status: 'draft', info: { name } }] }]
    }),
    withoutItem: (current, key) => ({ ...current, items: current.items.filter(item => item.key !== key) }),
    filenameFromKey: key => `${key.replaceAll('_', '-')}.json`,
    loadWorkspace: vi.fn(async () => workspace()),
    writeStagedSources: vi.fn(async (_workspace, current) => ({
      directory: '/workspace/items',
      files: current.items.map(item => `/workspace/items/${item.key.replaceAll('_', '-')}.json`)
    })),
    writeWorkspace: vi.fn(async () => files),
    filesDirectory: written => written.itemDirectory,
    stateFiles: written => ({ stateFile: written.stateFile }),
    validateManifest: vi.fn(() => []),
    prerequisiteErrors: current => current.prerequisiteErrors,
    fetchSnapshot: vi.fn(async () => ({ manifest: manifest(), runtime: manifest(), summaries: [] })),
    planSync: vi.fn(() => plan()),
    listSummaries: vi.fn(async () => [{ id: 'tpl-1', name: 'Send message', version: '1.0', status: 'published' }]),
    summaryRow: summary => summary,
    publishCandidates: vi.fn(() => []),
    executePlan: vi.fn(async () => ({ total: 0, succeeded: 0, failed: 0, applied: [], results: [] })),
    verifyApplied: vi.fn(() => []),
    reconcileAfterPush: vi.fn((_local, remote) => remote),
    createVersion: vi.fn(async () => ({ version: '1.1' })),
    submitForReview: vi.fn(async () => undefined),
    publishSummary: vi.fn(async () => undefined),
    ...overrides
  }
}

let config: Config
let logged: string[]

beforeAll(async () => {
  config = await Config.load({ root: process.cwd() })
})

beforeEach(() => {
  logged = []
  vi.spyOn(Command.prototype, 'log').mockImplementation((message = '') => {
    logged.push(String(message))
  })
  vi.mocked(loadWorkflowRemoteContext).mockResolvedValue({ appId: 'app-1', client })
  process.exitCode = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(loadWorkflowSyncContext).mockReset()
  vi.mocked(loadWorkflowRemoteContext).mockReset()
  process.exitCode = undefined
})

function syncContext(
  resource: FakeResource,
  overrides: Partial<Awaited<ReturnType<typeof loadWorkflowSyncContext>>> = {}
) {
  const local = workspace()
  vi.mocked(loadWorkflowSyncContext).mockImplementation(async () => ({
    appId: 'app-1',
    client,
    directory: local.directory,
    local,
    remote: local.manifest,
    runtime: local.manifest,
    summaries: [],
    plan: resource.planSync(local.manifest, local.manifest, local.manifest),
    ...overrides
  }))
}

describe('workflowResourceCommands', () => {
  it('validates the workspace and reports the item count', async () => {
    const resource = fakeResource()
    const { Validate } = workflowResourceCommands(resource)

    await expect(new Validate(['--json', '--item', 'send_message', '--publishable'], config).run()).resolves.toEqual({
      valid: true,
      appId: 'app-1',
      items: 1,
      errors: []
    })
    expect(resource.validateManifest).toHaveBeenCalledWith(manifest(), {
      publishable: true,
      key: 'send_message',
      version: undefined
    })
  })

  it('combines manifest and prerequisite errors under the resource label', async () => {
    const resource = fakeResource({
      loadWorkspace: vi.fn(async () => workspace([published], ['scope missing'])),
      validateManifest: vi.fn(() => ['items[0].key is invalid'])
    })
    const { Validate } = workflowResourceCommands(resource)

    await expect(new Validate([], config).run()).rejects.toThrow(
      'Fake item configuration is invalid:\n- items[0].key is invalid\n- scope missing'
    )
  })

  it('refuses to create without a name and key when not interactive', async () => {
    const { Create } = workflowResourceCommands(fakeResource())
    await expect(new Create(['Only name'], config).run()).rejects.toThrow(
      'Pass the item name and --key when running non-interactively.'
    )
  })

  it('stages a new item and names the written file after the resource', async () => {
    const resource = fakeResource()
    const { Create } = workflowResourceCommands(resource)

    await expect(new Create(['New item', '--key', 'new_item', '--json'], config).run()).resolves.toEqual({
      appId: 'app-1',
      key: 'new_item',
      name: 'New item',
      itemFile: '/workspace/items/new-item.json',
      staged: true
    })
    expect(resource.writeStagedSources).toHaveBeenCalledWith(
      expect.objectContaining({ directory: '/workspace' }),
      expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ key: 'new_item' })]) })
    )
  })

  it('requires --force to stage a deletion non-interactively', async () => {
    const { Delete } = workflowResourceCommands(fakeResource())
    await expect(new Delete(['send_message'], config).run()).rejects.toThrow(
      'Pass --force to remove a workflow item non-interactively.'
    )
  })

  it('stages a deletion by key or template id', async () => {
    const resource = fakeResource()
    const { Delete } = workflowResourceCommands(resource)

    await expect(new Delete(['tpl-1', '--force', '--json'], config).run()).resolves.toEqual({
      appId: 'app-1',
      key: 'send_message',
      itemDirectory: '/workspace/items',
      stagedDeletion: true
    })
    expect(resource.writeStagedSources).toHaveBeenCalledWith(expect.anything(), manifest([]))
  })

  it('lists registry summaries as JSON or as a table', async () => {
    const resource = fakeResource()
    const { List } = workflowResourceCommands(resource)

    await expect(new List(['--json'], config).run()).resolves.toEqual({
      appId: 'app-1',
      items: [{ id: 'tpl-1', name: 'Send message', version: '1.0', status: 'published' }]
    })
    await new List([], config).run()
    expect(logged.at(-1)).toMatch(/ITEM ID\s+NAME\s+VERSION\s+STATUS/)
    expect(logged.at(-1)).toMatch(/tpl-1\s+Send message\s+1\.0\s+published/)
  })

  it('reports the three-way plan from diff', async () => {
    const resource = fakeResource({
      planSync: vi.fn(() =>
        plan({
          localChanges: ['items.send_message.versions.1.0.info.name'],
          operations: [{ type: 'update', key: 'send_message', version: '1.0' }]
        })
      )
    })
    syncContext(resource)
    const { Diff } = workflowResourceCommands(resource)

    await expect(new Diff(['--json'], config).run()).resolves.toEqual({
      appId: 'app-1',
      localChanges: ['items.send_message.versions.1.0.info.name'],
      portalChanges: [],
      conflicts: [],
      errors: [],
      operations: [{ type: 'update', key: 'send_message' }]
    })
  })

  it('returns the API plan for a dry-run push without executing it', async () => {
    const resource = fakeResource({
      planSync: vi.fn(() => plan({ localChanges: ['items.new'], operations: [{ type: 'create', key: 'new' }] }))
    })
    syncContext(resource)
    const { Push } = workflowResourceCommands(resource)

    await expect(new Push(['--dry-run', '--json'], config).run()).resolves.toEqual({
      dryRun: true,
      appId: 'app-1',
      operations: [{ type: 'create', key: 'new' }],
      changes: ['items.new']
    })
    expect(resource.executePlan).not.toHaveBeenCalled()
  })

  it('fails closed on deletions without --force when not interactive', async () => {
    const resource = fakeResource({
      planSync: vi.fn(() => plan({ operations: [{ type: 'delete', key: 'send_message' }] }))
    })
    syncContext(resource)
    const { Push } = workflowResourceCommands(resource)

    await expect(new Push([], config).run()).rejects.toThrow(
      'Workflow item deletions require --force when running non-interactively.'
    )
  })

  it('marks verification mismatches as failures and reconciles only successful keys', async () => {
    const resource = fakeResource({
      planSync: vi.fn(() =>
        plan({
          operations: [
            { type: 'update', key: 'send_message', version: '1.0' },
            { type: 'create', key: 'new' }
          ]
        })
      ),
      executePlan: vi.fn(async () => ({
        total: 2,
        succeeded: 2,
        failed: 0,
        applied: ['update:send_message@1.0', 'create:new'],
        results: [
          { operation: 'update:send_message@1.0', type: 'update' as const, key: 'send_message', success: true },
          { operation: 'create:new', type: 'create' as const, key: 'new', success: true }
        ]
      })),
      verifyApplied: vi.fn(() => ['create:new'])
    })
    syncContext(resource)
    const { Push } = workflowResourceCommands(resource)

    const result = (await new Push(['--json'], config).run()) as {
      failed: number
      results: Array<{ key: string; success: boolean }>
    }
    expect(result.failed).toBe(1)
    expect(result.results.find(item => item.key === 'new')?.success).toBe(false)
    expect(process.exitCode).toBe(1)
    expect(resource.reconcileAfterPush).toHaveBeenCalledWith(expect.anything(), expect.anything(), new Set(['new']))
    expect(resource.writeWorkspace).toHaveBeenCalledWith('/workspace', expect.anything(), expect.anything())
  })

  it('creates a draft from the latest published version', async () => {
    const resource = fakeResource()
    syncContext(resource)
    const { NewVersion } = workflowResourceCommands(resource)

    await expect(new NewVersion(['send_message', '--json'], config).run()).resolves.toEqual({
      appId: 'app-1',
      key: 'send_message',
      version: '1.1',
      files
    })
    expect(resource.createVersion).toHaveBeenCalledWith(client, 'app-1', 'tpl-1')
  })

  it('rejects a new version while local changes are pending', async () => {
    const resource = fakeResource({ planSync: vi.fn(() => plan({ localChanges: ['items.send_message'] })) })
    syncContext(resource)
    const { NewVersion } = workflowResourceCommands(resource)

    await expect(new NewVersion(['send_message'], config).run()).rejects.toThrow(
      'Push or discard local workflow item changes before creating a new version.'
    )
  })

  it('requires the key, notes, and --force to publish non-interactively', async () => {
    const { Publish } = workflowResourceCommands(fakeResource())
    await expect(new Publish(['send_message', '--notes', 'Release'], config).run()).rejects.toThrow(
      'Pass the item key, --notes, and --force when publishing non-interactively.'
    )
  })

  it('submits a draft for review, publishes the registry entry, and refreshes the workspace', async () => {
    const draft: WorkflowResourceDefinition = {
      templateId: 'tpl-2',
      key: 'draft_item',
      versions: [{ version: '2.0', status: 'draft', info: { name: 'Draft item' } }]
    }
    const resource = fakeResource({
      publishCandidates: vi.fn(() => [{ item: draft, version: draft.versions[0], repairRegistry: false }])
    })
    syncContext(resource)
    const { Publish } = workflowResourceCommands(resource)

    await expect(
      new Publish(['draft_item', '--notes', ' Initial release ', '--force', '--json'], config).run()
    ).resolves.toEqual({
      appId: 'app-1',
      key: 'draft_item',
      version: '2.0',
      status: 'published',
      repairedRegistry: false,
      files
    })
    expect(resource.validateManifest).toHaveBeenCalledWith(expect.anything(), {
      publishable: true,
      key: 'draft_item',
      version: '2.0'
    })
    expect(resource.submitForReview).toHaveBeenCalledWith(client, 'app-1', 'tpl-2', '2.0', 'Initial release')
    expect(resource.publishSummary).toHaveBeenCalledWith(client, 'app-1', 'tpl-2', '2.0')
  })

  it('explains how to repair the registry when the summary publication fails', async () => {
    const draft: WorkflowResourceDefinition = {
      templateId: 'tpl-2',
      key: 'draft_item',
      versions: [{ version: '2.0', status: 'draft', info: { name: 'Draft item' } }]
    }
    const resource = fakeResource({
      publishCandidates: vi.fn(() => [{ item: draft, version: draft.versions[0], repairRegistry: false }]),
      publishSummary: vi.fn(async () => {
        throw new Error('registry offline')
      })
    })
    syncContext(resource)
    const { Publish } = workflowResourceCommands(resource)

    await expect(new Publish(['draft_item', '--notes', 'Release', '--force'], config).run()).rejects.toThrow(
      /registry update failed: registry offline Re-run this command with the same item and version/
    )
  })
})

describe('withVerificationMismatches', () => {
  it('recomputes the totals after downgrading mismatched operations', () => {
    const verified = withVerificationMismatches(
      {
        total: 2,
        succeeded: 1,
        failed: 1,
        applied: ['create:a'],
        results: [
          { operation: 'create:a', type: 'create', key: 'a', success: true },
          { operation: 'delete:b', type: 'delete', key: 'b', success: false, error: 'boom' }
        ]
      },
      new Set(['create:a'])
    )
    expect(verified).toEqual({
      total: 2,
      succeeded: 0,
      failed: 2,
      applied: [],
      results: [
        {
          operation: 'create:a',
          type: 'create',
          key: 'a',
          success: false,
          error: 'The portal state did not match the requested configuration after the API call.'
        },
        { operation: 'delete:b', type: 'delete', key: 'b', success: false, error: 'boom' }
      ]
    })
  })
})
