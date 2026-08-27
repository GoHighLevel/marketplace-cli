import { describe, expect, it, vi } from 'vitest'

import { WorkflowTriggerSummary } from '../../../../src/lib/api/client.js'
import {
  executeWorkflowTriggersSyncPlanIndependently,
  fetchWorkflowTriggersSnapshot,
  reconcileWorkflowTriggersAfterPush,
  verifyWorkflowTriggersApplied,
  workflowTriggerPublishCandidates,
  WorkflowTriggersApi
} from '../../../../src/lib/workflows/triggers/service.js'
import { WorkflowTriggersSyncPlan } from '../../../../src/lib/workflows/triggers/sync.js'

function summary(): WorkflowTriggerSummary {
  return {
    _id: 'summary-1',
    triggerId: 'template-1',
    name: 'Contact changed',
    version: '1.0',
    status: 'draft'
  }
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    templateId: 'template-1',
    appId: 'app-1',
    key: 'contact_changed',
    version: '1.0',
    status: 'draft',
    info: { name: 'Contact changed' },
    ...overrides
  }
}

function api(overrides: Partial<WorkflowTriggersApi> = {}): WorkflowTriggersApi {
  return {
    listWorkflowTriggerSummaries: vi.fn().mockResolvedValue([summary()]),
    listWorkflowTriggerConfigs: vi.fn().mockResolvedValue([config()]),
    getWorkflowTriggerConfigs: vi.fn().mockResolvedValue([config()]),
    checkWorkflowTriggerKeyAvailability: vi.fn().mockResolvedValue(true),
    createWorkflowTrigger: vi.fn().mockResolvedValue(summary()),
    createWorkflowTriggerVersion: vi.fn().mockResolvedValue(summary()),
    updateWorkflowTriggerConfig: vi.fn().mockResolvedValue(undefined),
    updateWorkflowTriggerSummary: vi.fn().mockResolvedValue(summary()),
    deleteWorkflowTrigger: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('workflow trigger service orchestration', () => {
  it('recovers a registry version missing from the bulk workflow response', async () => {
    const latest = { ...summary(), version: '1.1' }
    const client = api({
      listWorkflowTriggerSummaries: vi.fn().mockResolvedValue([latest]),
      listWorkflowTriggerConfigs: vi.fn().mockResolvedValue([{ ...config(), status: 'published' }]),
      getWorkflowTriggerConfigs: vi.fn().mockResolvedValue([config({ version: '1.1' })])
    })

    const snapshot = await fetchWorkflowTriggersSnapshot(client, 'app-1')
    expect(snapshot.manifest.triggers[0].versions.map(version => version.version)).toEqual(['1.1', '1.0'])
    expect(client.getWorkflowTriggerConfigs).toHaveBeenCalledWith('app-1', 'template-1', '1.1')
  })

  it('does not query workflow configurations when the oauth registry is empty', async () => {
    const client = api({ listWorkflowTriggerSummaries: vi.fn().mockResolvedValue([]) })

    await expect(fetchWorkflowTriggersSnapshot(client, 'app-1')).resolves.toMatchObject({
      manifest: { schemaVersion: 1, appId: 'app-1', triggers: [] },
      summaries: []
    })
    expect(client.listWorkflowTriggerConfigs).not.toHaveBeenCalled()
  })

  it('fails closed for duplicate or cross-app workflow configuration', async () => {

    await expect(fetchWorkflowTriggersSnapshot(api({
      listWorkflowTriggerConfigs: vi.fn().mockResolvedValue([config(), config()])
    }), 'app-1')).rejects.toThrow(/duplicate template-1:1\.0/i)

    await expect(fetchWorkflowTriggersSnapshot(api({
      listWorkflowTriggerConfigs: vi.fn().mockResolvedValue([config({ appId: 'app-2' })])
    }), 'app-1')).rejects.toThrow(/belongs to app "app-2"/i)
  })

  it('redacts local headers while retaining runtime values for safe preservation', async () => {
    const snapshot = await fetchWorkflowTriggersSnapshot(api({
      listWorkflowTriggerConfigs: vi.fn().mockResolvedValue([config({
        subscriptionConfig: {
          url: 'https://example.com/subscriptions',
          headers: { Authorization: 'Bearer secret' }
        }
      })])
    }), 'app-1')

    expect(snapshot.manifest.triggers[0].versions[0].subscriptionConfig?.headers?.Authorization).toBe('${remote}')
    expect(snapshot.runtime.triggers[0].versions[0].subscriptionConfig?.headers?.Authorization).toBe('Bearer secret')
  })

  it('preflights key availability and all secret references before any mutation', async () => {
    const client = api({ checkWorkflowTriggerKeyAvailability: vi.fn().mockResolvedValue(false) })
    const plan: WorkflowTriggersSyncPlan = {
      appId: 'app-1', localChanges: ['triggers.first'], remoteChanges: [], conflicts: [], errors: [],
      operations: [{
        type: 'create',
        key: 'first',
        desired: {
          key: 'first',
          versions: [{
            version: '1.0',
            status: 'draft',
            info: { name: 'First' },
            subscriptionConfig: {
              url: 'https://example.com/subscriptions',
              headers: { Authorization: '${env:MISSING_TOKEN}' }
            }
          }]
        }
      }]
    }

    await expect(executeWorkflowTriggersSyncPlanIndependently(client, plan, { environment: {} }))
      .rejects.toThrow(/MISSING_TOKEN/)
    expect(client.checkWorkflowTriggerKeyAvailability).not.toHaveBeenCalled()
    expect(client.createWorkflowTrigger).not.toHaveBeenCalled()

    plan.operations[0] = {
      type: 'create',
      key: 'first',
      desired: { key: 'first', versions: [{ version: '1.0', status: 'draft', info: { name: 'First' } }] }
    }
    const result = await executeWorkflowTriggersSyncPlanIndependently(client, plan)
    expect(result.results[0]).toMatchObject({ success: false, error: expect.stringMatching(/no longer available/i) })
    expect(client.createWorkflowTrigger).not.toHaveBeenCalled()
  })

  it('updates only changed trigger configuration and registry name', async () => {
    const client = api()
    const plan: WorkflowTriggersSyncPlan = {
      appId: 'app-1', localChanges: ['triggers.contact_changed.versions.1.0.info.name'], remoteChanges: [], conflicts: [], errors: [],
      operations: [{
        type: 'update', key: 'contact_changed', templateId: 'template-1', version: '1.0',
        current: { version: '1.0', status: 'draft', info: { name: 'Contact changed' } },
        desired: { version: '1.0', status: 'draft', info: { name: 'Contact updated' } },
        updateSummary: true
      }]
    }

    const result = await executeWorkflowTriggersSyncPlanIndependently(client, plan)
    expect(result.succeeded).toBe(1)
    expect(client.updateWorkflowTriggerConfig).toHaveBeenCalledOnce()
    expect(client.updateWorkflowTriggerSummary).toHaveBeenCalledWith('app-1', 'template-1', { name: 'Contact updated' })
  })

  it('hydrates remote-preservation references from unredacted runtime state', async () => {
    const client = api()
    const desired = {
      version: '1.0', status: 'draft' as const, info: { name: 'Contact changed', description: 'Updated' },
      subscriptionConfig: { url: 'https://example.com/subscriptions', headers: { Authorization: '${remote}' } }
    }
    const plan: WorkflowTriggersSyncPlan = {
      appId: 'app-1', localChanges: ['triggers.contact_changed.versions.1.0.info.description'], remoteChanges: [], conflicts: [], errors: [],
      operations: [{
        type: 'update', key: 'contact_changed', templateId: 'template-1', version: '1.0',
        current: desired, desired, updateSummary: false
      }]
    }
    const runtime = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      triggers: [{
        templateId: 'template-1', key: 'contact_changed', versions: [{
          ...desired,
          subscriptionConfig: { url: 'https://example.com/subscriptions', headers: { Authorization: 'Bearer actual' } }
        }]
      }]
    }

    await executeWorkflowTriggersSyncPlanIndependently(client, plan, { runtime })
    expect(client.updateWorkflowTriggerConfig).toHaveBeenCalledWith(
      'app-1',
      'template-1',
      expect.objectContaining({ subscriptionConfig: expect.objectContaining({ headers: { Authorization: 'Bearer actual' } }) })
    )
  })

  it('reconciles partial failures and verifies references canonically', () => {
    const local = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      triggers: [{
        key: 'contact_changed',
        versions: [{ version: '1.0', status: 'draft' as const, info: { name: 'Contact changed', description: 'Retry' } }]
      }]
    }
    const remote = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      triggers: [{
        templateId: 'template-1',
        key: 'contact_changed',
        versions: [{ version: '1.0', status: 'draft' as const, info: { name: 'Contact changed' } }]
      }]
    }
    expect(reconcileWorkflowTriggersAfterPush(local, remote, new Set(['contact_changed']))).toEqual({
      ...local,
      triggers: [{ ...local.triggers[0], templateId: 'template-1' }]
    })

    const desired = {
      version: '1.0', status: 'draft' as const, info: { name: 'Contact changed' },
      subscriptionConfig: { url: 'https://example.com/subscriptions', headers: { Authorization: '${env:TOKEN}' } }
    }
    const plan: WorkflowTriggersSyncPlan = {
      appId: 'app-1', localChanges: [], remoteChanges: [], conflicts: [], errors: [],
      operations: [{
        type: 'update', key: 'contact_changed', templateId: 'template-1', version: '1.0',
        current: desired, desired, updateSummary: false
      }]
    }
    remote.triggers[0].versions[0] = {
      ...desired,
      subscriptionConfig: { url: 'https://example.com/subscriptions', headers: { Authorization: '${remote}' } }
    }
    expect(verifyWorkflowTriggersApplied(plan, remote)).toEqual([])
  })

  it('finds drafts and registry repairs as publication candidates', () => {
    const draftManifest = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      triggers: [{ templateId: 'template-1', key: 'contact_changed', versions: [config()] }]
    }
    expect(workflowTriggerPublishCandidates(draftManifest, [summary()])).toHaveLength(1)

    draftManifest.triggers[0].versions[0].status = 'published'
    expect(workflowTriggerPublishCandidates(draftManifest, [{ ...summary(), status: 'approved', isActive: true }])).toEqual([])
  })

  it('treats omitted empty trigger defaults as a successful create', () => {
    const plan: WorkflowTriggersSyncPlan = {
      appId: 'app-1',
      localChanges: ['triggers.contact_changed'],
      remoteChanges: [],
      conflicts: [],
      errors: [],
      operations: [{
        type: 'create',
        key: 'contact_changed',
        desired: {
          key: 'contact_changed',
          versions: [{
            version: '1.0',
            status: 'draft',
            info: { name: 'Contact changed' },
            filters: [],
            customVars: [],
            customVarsJson: {}
          }]
        }
      }]
    }
    const remote = {
      schemaVersion: 1 as const,
      appId: 'app-1',
      triggers: [{
        templateId: 'template-1',
        key: 'contact_changed',
        versions: [{
          version: '1.0',
          status: 'draft' as const,
          info: { name: 'Contact changed' },
          filters: [],
          customVars: []
        }]
      }]
    }

    expect(verifyWorkflowTriggersApplied(plan, remote)).toEqual([])
  })
})
