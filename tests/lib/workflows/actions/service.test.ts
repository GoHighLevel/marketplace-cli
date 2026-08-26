import { describe, expect, it, vi } from 'vitest'

import { WorkflowActionSummary } from '../../../../src/lib/api/client.js'
import {
  executeWorkflowActionsSyncPlan,
  executeWorkflowActionsSyncPlanIndependently,
  fetchWorkflowActionsManifest,
  reconcileWorkflowActionsAfterPush,
  verifyWorkflowActionsApplied,
  workflowActionPublishCandidates,
  WorkflowActionsApi
} from '../../../../src/lib/workflows/actions/service.js'
import { WorkflowActionsSyncPlan } from '../../../../src/lib/workflows/actions/sync.js'

function summary(): WorkflowActionSummary {
  return {
    _id: 'summary-1',
    actionId: 'template-1',
    name: 'Send message',
    version: '1.0',
    status: 'draft'
  }
}

function config(description?: string) {
  return {
    templateId: 'template-1',
    appId: 'app-1',
    key: 'send_message',
    version: '1.0',
    status: 'draft',
    info: { name: 'Send message', ...(description ? { description } : {}) }
  }
}

function api(overrides: Partial<WorkflowActionsApi> = {}): WorkflowActionsApi {
  return {
    listWorkflowActionSummaries: vi.fn().mockResolvedValue([summary()]),
    listWorkflowActionConfigs: vi.fn().mockResolvedValue([config()]),
    getWorkflowActionConfigs: vi.fn().mockResolvedValue([config()]),
    checkWorkflowActionKeyAvailability: vi.fn().mockResolvedValue(true),
    createWorkflowAction: vi.fn().mockResolvedValue(summary()),
    updateWorkflowActionConfig: vi.fn().mockResolvedValue(undefined),
    updateWorkflowActionSummary: vi.fn().mockResolvedValue(summary()),
    deleteWorkflowAction: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('workflow action service orchestration', () => {
  it('recovers a temporarily missing bulk-list config with one targeted read', async () => {
    const client = api({ listWorkflowActionConfigs: vi.fn().mockResolvedValue([]) })

    await expect(fetchWorkflowActionsManifest(client, 'app-1')).resolves.toMatchObject({
      appId: 'app-1',
      actions: [{ templateId: 'template-1', key: 'send_message' }]
    })
    expect(client.getWorkflowActionConfigs).toHaveBeenCalledWith('app-1', 'template-1', '1.0')
  })

  it('recovers the registry version when the bulk list only contains older action versions', async () => {
    const latestSummary = { ...summary(), version: '1.1' }
    const latestConfig = { ...config(), version: '1.1' }
    const client = api({
      listWorkflowActionSummaries: vi.fn().mockResolvedValue([latestSummary]),
      listWorkflowActionConfigs: vi.fn().mockResolvedValue([{ ...config(), status: 'published' }]),
      getWorkflowActionConfigs: vi.fn().mockResolvedValue([latestConfig])
    })

    await expect(fetchWorkflowActionsManifest(client, 'app-1')).resolves.toMatchObject({
      actions: [{ versions: [{ version: '1.1' }, { version: '1.0' }] }]
    })
    expect(client.getWorkflowActionConfigs).toHaveBeenCalledWith('app-1', 'template-1', '1.1')
  })

  it('fails closed when the oauth registry and workflow service disagree', async () => {
    const client = api({
      listWorkflowActionConfigs: vi.fn().mockResolvedValue([]),
      getWorkflowActionConfigs: vi.fn().mockResolvedValue([])
    })

    await expect(fetchWorkflowActionsManifest(client, 'app-1')).rejects.toThrow(/registry.*template-1.*configuration/i)
  })

  it('fails when the workflow service contains an action missing from the oauth registry', async () => {
    const client = api({
      listWorkflowActionSummaries: vi.fn().mockResolvedValue([]),
      listWorkflowActionConfigs: vi.fn().mockResolvedValue([config()])
    })

    await expect(fetchWorkflowActionsManifest(client, 'app-1')).rejects.toThrow(/configuration.*template-1.*registry/i)
  })

  it('detects a published workflow version whose oauth registry update needs recovery', () => {
    const manifest = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      actions: [{
        templateId: 'template-1',
        key: 'send_message',
        versions: [{ version: '1.0', status: 'published' as const, info: { name: 'Send message' } }]
      }]
    }

    expect(workflowActionPublishCandidates(manifest, [summary()])).toEqual([
      expect.objectContaining({
        action: expect.objectContaining({ key: 'send_message' }),
        version: expect.objectContaining({ version: '1.0' }),
        repairRegistry: true
      })
    ])
    expect(workflowActionPublishCandidates(manifest, [{
      ...summary(),
      status: 'approved',
      isActive: true
    }])).toEqual([])
  })

  it('creates a minimal action without a redundant configuration update', async () => {
    const client = api()
    const plan: WorkflowActionsSyncPlan = {
      appId: 'app-1',
      localChanges: ['actions.send_message'],
      remoteChanges: [],
      conflicts: [],
      errors: [],
      operations: [
        {
          type: 'create',
          key: 'send_message',
          desired: {
            key: 'send_message',
            versions: [{ version: '1.0', status: 'draft', info: { name: 'Send message' } }]
          }
        }
      ]
    }

    await expect(executeWorkflowActionsSyncPlan(client, plan)).resolves.toEqual(['create:send_message'])
    expect(client.checkWorkflowActionKeyAvailability).toHaveBeenCalledOnce()
    expect(client.createWorkflowAction).toHaveBeenCalledOnce()
    expect(client.updateWorkflowActionConfig).not.toHaveBeenCalled()
    expect(client.updateWorkflowActionSummary).not.toHaveBeenCalled()
  })

  it('updates configuration once and touches the registry only when the visible name changed', async () => {
    const client = api()
    const plan: WorkflowActionsSyncPlan = {
      appId: 'app-1',
      localChanges: ['actions.send_message.versions.1.0.info.name'],
      remoteChanges: [],
      conflicts: [],
      errors: [],
      operations: [
        {
          type: 'update',
          key: 'send_message',
          templateId: 'template-1',
          version: '1.0',
          current: { version: '1.0', status: 'draft', info: { name: 'Send message' } },
          desired: { version: '1.0', status: 'draft', info: { name: 'Send notification' } },
          updateSummary: true
        }
      ]
    }

    await executeWorkflowActionsSyncPlan(client, plan)
    expect(client.updateWorkflowActionConfig).toHaveBeenCalledTimes(1)
    expect(client.updateWorkflowActionSummary).toHaveBeenCalledWith('app-1', 'template-1', {
      name: 'Send notification'
    })
  })

  it('hydrates remote-preservation references from runtime-only action data', async () => {
    const client = api()
    const plan: WorkflowActionsSyncPlan = {
      appId: 'app-1',
      localChanges: ['actions.send_message.versions.1.0.info.description'],
      remoteChanges: [],
      conflicts: [],
      errors: [],
      operations: [
        {
          type: 'update',
          key: 'send_message',
          templateId: 'template-1',
          version: '1.0',
          current: {
            version: '1.0',
            status: 'draft',
            info: { name: 'Send message' },
            executionConfig: { type: 'API', headers: { Authorization: '${remote}' } }
          },
          desired: {
            version: '1.0',
            status: 'draft',
            info: { name: 'Send message', description: 'Changed' },
            executionConfig: { type: 'API', headers: { Authorization: '${remote}' } }
          },
          updateSummary: false
        }
      ]
    }
    const runtime = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      actions: [
        {
          templateId: 'template-1',
          key: 'send_message',
          versions: [
            {
              version: '1.0',
              status: 'draft' as const,
              info: { name: 'Send message' },
              executionConfig: { type: 'API' as const, headers: { Authorization: 'Bearer actual-secret' } }
            }
          ]
        }
      ]
    }

    await executeWorkflowActionsSyncPlan(client, plan, { runtime })
    expect(client.updateWorkflowActionConfig).toHaveBeenCalledWith(
      'app-1',
      'template-1',
      expect.objectContaining({
        executionConfig: expect.objectContaining({ headers: { Authorization: 'Bearer actual-secret' } })
      })
    )
  })

  it('resolves every secret reference before making the first mutation', async () => {
    const client = api()
    const plan: WorkflowActionsSyncPlan = {
      appId: 'app-1',
      localChanges: ['actions.first', 'actions.second'],
      remoteChanges: [],
      conflicts: [],
      errors: [],
      operations: [
        {
          type: 'create',
          key: 'first',
          desired: { key: 'first', versions: [{ version: '1.0', status: 'draft', info: { name: 'First' } }] }
        },
        {
          type: 'create',
          key: 'second',
          desired: {
            key: 'second',
            versions: [{
              version: '1.0',
              status: 'draft',
              info: { name: 'Second' },
              executionConfig: {
                type: 'API',
                url: 'https://example.com/action',
                headers: { Authorization: '${env:MISSING_TOKEN}' }
              }
            }]
          }
        }
      ]
    }

    await expect(executeWorkflowActionsSyncPlan(client, plan, { environment: {} })).rejects.toThrow(/MISSING_TOKEN/)
    expect(client.checkWorkflowActionKeyAvailability).not.toHaveBeenCalled()
    expect(client.createWorkflowAction).not.toHaveBeenCalled()
  })

  it('pushes valid action operations independently and reports every success and failure', async () => {
    const client = api({
      createWorkflowAction: vi.fn().mockImplementation(async (appId: string, body: { name: string }) => {
        if (body.name === 'Second') throw new Error('Second action rejected')
        return { ...summary(), actionId: `template-${body.name.toLowerCase()}`, name: body.name, appId }
      })
    })
    const plan: WorkflowActionsSyncPlan = {
      appId: 'app-1',
      localChanges: ['actions.first', 'actions.second', 'actions.third'],
      remoteChanges: [],
      conflicts: [],
      errors: [],
      operations: ['First', 'Second', 'Third'].map(name => ({
        type: 'create' as const,
        key: name.toLowerCase(),
        desired: {
          key: name.toLowerCase(),
          versions: [{ version: '1.0', status: 'draft' as const, info: { name } }]
        }
      }))
    }

    await expect(executeWorkflowActionsSyncPlanIndependently(client, plan)).resolves.toEqual({
      total: 3,
      succeeded: 2,
      failed: 1,
      applied: ['create:first', 'create:third'],
      results: [
        { operation: 'create:first', type: 'create', key: 'first', success: true },
        {
          operation: 'create:second',
          type: 'create',
          key: 'second',
          success: false,
          error: 'Second action rejected'
        },
        { operation: 'create:third', type: 'create', key: 'third', success: true }
      ]
    })
    expect(client.createWorkflowAction).toHaveBeenCalledTimes(3)
  })

  it('keeps failed local actions pending while adopting server identities created before failure', () => {
    const local = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      actions: [
        {
          key: 'first',
          versions: [{ version: '1.0', status: 'draft' as const, info: { name: 'First', description: 'Ready' } }]
        },
        {
          key: 'second',
          versions: [{ version: '1.0', status: 'draft' as const, info: { name: 'Second', description: 'Retry me' } }]
        }
      ]
    }
    const remote = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      actions: [
        {
          templateId: 'template-first',
          key: 'first',
          versions: [{ version: '1.0', status: 'draft' as const, info: { name: 'First', description: 'Ready' } }]
        },
        {
          templateId: 'template-second',
          key: 'second',
          versions: [{ version: '1.0', status: 'draft' as const, info: { name: 'Second' } }]
        }
      ]
    }

    expect(reconcileWorkflowActionsAfterPush(local, remote, new Set(['second']))).toEqual({
      schemaVersion: 1,
      appId: 'app-1',
      actions: [
        remote.actions[0],
        { ...local.actions[1], templateId: 'template-second' }
      ]
    })
  })

  it('verifies only planned results while treating secret references as equivalent', () => {
    const plan: WorkflowActionsSyncPlan = {
      appId: 'app-1',
      localChanges: ['actions.send_message.versions.1.0.executionConfig.headers.Authorization'],
      remoteChanges: [],
      conflicts: [],
      errors: [],
      operations: [
        {
          type: 'update',
          key: 'send_message',
          templateId: 'template-1',
          version: '1.0',
          current: { version: '1.0', status: 'draft', info: { name: 'Send message' } },
          desired: {
            version: '1.0',
            status: 'draft',
            info: { name: 'Send message' },
            executionConfig: {
              type: 'API',
              method: 'POST',
              url: 'https://example.com/action',
              headers: { Authorization: '${env:ACTION_TOKEN}' }
            }
          },
          updateSummary: false
        }
      ]
    }
    const remote = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      actions: [
        {
          templateId: 'template-1',
          key: 'send_message',
          versions: [
            {
              version: '1.0',
              status: 'draft' as const,
              info: { name: 'Send message' },
              executionConfig: {
                type: 'API' as const,
                method: 'POST' as const,
                url: 'https://example.com/action',
                headers: { Authorization: '${remote}' }
              }
            }
          ]
        }
      ]
    }

    expect(verifyWorkflowActionsApplied(plan, remote)).toEqual([])
    remote.actions[0].versions[0].executionConfig.url = 'https://example.com/wrong'
    expect(verifyWorkflowActionsApplied(plan, remote)).toEqual(['update:send_message@1.0'])
  })
})
