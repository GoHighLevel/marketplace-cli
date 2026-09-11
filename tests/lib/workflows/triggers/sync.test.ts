import { describe, expect, it } from 'vitest'

import { type WorkflowTriggersManifest } from '../../../../src/lib/workflows/triggers/manifest.js'
import { planWorkflowTriggersSync } from '../../../../src/lib/workflows/triggers/sync.js'

function manifest(name = 'Original'): WorkflowTriggersManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    triggers: [
      {
        templateId: 'template-1',
        key: 'contact_changed',
        versions: [
          {
            version: '1.0',
            status: 'draft',
            info: { name },
            customVarsJson: { contact: { id: 'one' } },
            subscriptionConfig: { url: 'https://example.com/subscriptions' }
          }
        ]
      }
    ]
  }
}

describe('workflow trigger three-way synchronization', () => {
  it('merges non-overlapping portal changes and sends one update', () => {
    const baseline = manifest()
    const local = structuredClone(baseline)
    const remote = structuredClone(baseline)
    local.triggers[0].versions[0].info.description = 'Local description'
    remote.triggers[0].versions[0].info.summary = 'Portal summary'

    const plan = planWorkflowTriggersSync(baseline, local, remote)
    expect(plan.conflicts).toEqual([])
    expect(plan.errors).toEqual([])
    expect(plan.operations).toHaveLength(1)
    expect(plan.operations[0]).toMatchObject({
      type: 'update',
      key: 'contact_changed',
      desired: { info: { description: 'Local description', summary: 'Portal summary' } }
    })
  })

  it('stops when the same field changed locally and in the portal', () => {
    const baseline = manifest()
    const local = manifest('Local')
    const remote = manifest('Portal')
    const plan = planWorkflowTriggersSync(baseline, local, remote)

    expect(plan.operations).toEqual([])
    expect(plan.conflicts).toContain('triggers.contact_changed.versions.1.0.info.name')
  })

  it('creates and deletes independent trigger files without touching unchanged triggers', () => {
    const baseline = manifest()
    const local = structuredClone(baseline)
    const remote = structuredClone(baseline)
    local.triggers = [
      {
        key: 'order_created',
        versions: [{ version: '1.0', status: 'draft', info: { name: 'Order created' } }]
      }
    ]

    expect(planWorkflowTriggersSync(baseline, local, remote).operations).toMatchObject([
      { type: 'create', key: 'order_created' },
      { type: 'delete', key: 'contact_changed', templateId: 'template-1' }
    ])
  })

  it('rejects local edits to keys, template IDs, statuses, and published versions', () => {
    const baseline = manifest()
    baseline.triggers[0].versions[0].status = 'published'
    const local = structuredClone(baseline)
    const remote = structuredClone(baseline)
    local.triggers[0].versions[0].info.name = 'Edited published trigger'
    local.triggers[0].versions[0].status = 'draft'

    const plan = planWorkflowTriggersSync(baseline, local, remote)
    expect(plan.operations).toEqual([])
    expect(plan.errors.join('\n')).toContain('status is server-owned')
  })
})
