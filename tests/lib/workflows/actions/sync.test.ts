import { describe, expect, it } from 'vitest'

import { WorkflowActionsManifest } from '../../../../src/lib/workflows/actions/manifest.js'
import { planWorkflowActionsSync } from '../../../../src/lib/workflows/actions/sync.js'

function manifest(description = 'Base', summary = 'Base summary'): WorkflowActionsManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    actions: [
      {
        templateId: 'action-1',
        key: 'send_message',
        versions: [
          {
            version: '1.1',
            status: 'draft',
            info: { name: 'Send message', description, summary },
            inputs: [{ field: 'message', title: 'Message', fieldType: 'textarea' }]
          },
          { version: '1.0', status: 'published', info: { name: 'Send message' } }
        ]
      }
    ]
  }
}

describe('workflow action synchronization', () => {
  it('does not call an API for remote-only changes', () => {
    const base = manifest()
    const remote = manifest('Base', 'Changed in portal')
    const plan = planWorkflowActionsSync(base, base, remote)

    expect(plan.operations).toEqual([])
    expect(plan.remoteChanges).toContain('actions.send_message.versions.1.1.info.summary')
    expect(plan.conflicts).toEqual([])
  })

  it('merges non-overlapping local and portal changes into one update API call', () => {
    const base = manifest()
    const local = manifest('Changed locally', 'Base summary')
    const remote = manifest('Base', 'Changed in portal')
    const plan = planWorkflowActionsSync(base, local, remote)

    expect(plan.conflicts).toEqual([])
    expect(plan.operations).toHaveLength(1)
    expect(plan.operations[0]).toMatchObject({ type: 'update', key: 'send_message', templateId: 'action-1' })
    expect(plan.operations[0].type === 'update' && plan.operations[0].desired.info).toEqual({
      name: 'Send message',
      description: 'Changed locally',
      summary: 'Changed in portal'
    })
  })

  it('detects same-field conflicts instead of overwriting portal changes', () => {
    const plan = planWorkflowActionsSync(manifest(), manifest('Local'), manifest('Portal'))

    expect(plan.operations).toEqual([])
    expect(plan.conflicts).toEqual(['actions.send_message.versions.1.1.info.description'])
  })

  it('plans local additions and deletions explicitly', () => {
    const base = manifest()
    const local: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [
        {
          key: 'new_action',
          versions: [{ version: '1.0', status: 'draft', info: { name: 'New action' } }]
        }
      ]
    }
    const plan = planWorkflowActionsSync(base, local, base)

    expect(plan.operations.map(operation => operation.type)).toEqual(['create', 'delete'])
  })

  it('rejects edits to published versions', () => {
    const local = manifest()
    local.actions[0].versions[1].info.description = 'Cannot edit this'

    const plan = planWorkflowActionsSync(manifest(), local, manifest())
    expect(plan.errors).toContain(
      'actions.send_message version 1.0 is published and cannot be edited; run `ghl app actions new-version send_message` first.'
    )
  })

  it('rejects action key changes instead of translating them into delete and create', () => {
    const local = manifest()
    local.actions[0].key = 'renamed_action'

    const plan = planWorkflowActionsSync(manifest(), local, manifest())
    expect(plan.operations).toEqual([])
    expect(plan.errors).toContain(
      'actions.send_message.key is immutable; create a separate action and explicitly delete the old one.'
    )
  })
})
