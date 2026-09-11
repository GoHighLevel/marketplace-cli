import { describe, expect, it } from 'vitest'

import { type WorkflowTriggersManifest } from '../../../../src/lib/workflows/triggers/manifest.js'
import { WORKFLOW_TRIGGERS_RESOURCE } from '../../../../src/lib/workflows/triggers/resource.js'

const manifest: WorkflowTriggersManifest = {
  schemaVersion: 1,
  appId: 'app-1',
  triggers: [
    {
      templateId: 'tpl-1',
      key: 'order_created',
      versions: [{ version: '1.0', status: 'published', info: { name: 'Order created' } }]
    }
  ]
}

describe('WORKFLOW_TRIGGERS_RESOURCE', () => {
  it('adds scaffolds in key order and removes items by key', () => {
    const next = WORKFLOW_TRIGGERS_RESOURCE.withScaffold(manifest, 'Contact deleted', 'contact_deleted')
    expect(next.triggers.map(trigger => trigger.key)).toEqual(['contact_deleted', 'order_created'])
    expect(WORKFLOW_TRIGGERS_RESOURCE.withoutItem(next, 'order_created').triggers.map(t => t.key)).toEqual([
      'contact_deleted'
    ])
  })

  it('defaults a missing registry status to draft', () => {
    expect(
      WORKFLOW_TRIGGERS_RESOURCE.summaryRow({ _id: 'tpl-1', triggerId: 'tpl-1', name: 'Order created', version: '1.0' })
    ).toEqual({ id: 'tpl-1', name: 'Order created', version: '1.0', status: 'draft' })
  })

  it('translates shared validation options into trigger-specific ones', () => {
    const errors = WORKFLOW_TRIGGERS_RESOURCE.validateManifest(manifest, { publishable: true, key: 'missing' })
    expect(errors.some(error => error.includes('"missing"'))).toBe(true)
  })

  it('exposes the written directory and the state-only file subset', () => {
    const files = {
      triggerDirectory: '/w/triggers',
      triggerFiles: [],
      triggerGuideFile: '/w/triggers/GUIDE.md',
      triggerStateFile: '/w/.ghl/triggers.json'
    }
    expect(WORKFLOW_TRIGGERS_RESOURCE.filesDirectory(files)).toBe('/w/triggers')
    expect(WORKFLOW_TRIGGERS_RESOURCE.stateFiles(files)).toEqual({ triggerStateFile: '/w/.ghl/triggers.json' })
  })
})
