import { describe, expect, it } from 'vitest'

import { workflowPlanError } from '../../../../src/lib/workflows/shared/context.js'
import {
  findWorkflowItem,
  hasDraftVersion,
  workflowItemName,
  workflowOperationLabel
} from '../../../../src/lib/workflows/shared/resource.js'

const naming = { singular: 'action', plural: 'actions', label: 'Workflow action' }
const plan = { appId: 'app-1', localChanges: [], remoteChanges: [], conflicts: [], errors: [], operations: [] }

describe('workflowPlanError', () => {
  it('returns nothing for an executable plan', () => {
    expect(workflowPlanError(naming, plan)).toBeUndefined()
  })

  it('reports validation errors before conflicts', () => {
    const error = workflowPlanError(naming, { ...plan, errors: ['bad key'], conflicts: ['actions.x'] })
    expect(error?.message).toBe('Workflow action configuration cannot be pushed:\n- bad key')
  })

  it('tells the user how to resolve portal conflicts', () => {
    const error = workflowPlanError(naming, { ...plan, conflicts: ['actions.x.versions.1.0.info'] })
    expect(error?.message).toBe(
      'Workflow action configuration conflicts with portal changes:\n- actions.x.versions.1.0.info\n' +
        'Run `ghl app actions pull`, reapply the local changes, and retry.'
    )
  })
})

describe('resource helpers', () => {
  const item = {
    templateId: 'tpl-1',
    key: 'send_message',
    versions: [{ version: '1.0', status: 'draft', info: { name: 'Send message' } }]
  }

  it('labels operations the same way the services do', () => {
    expect(workflowOperationLabel({ type: 'update', key: 'a', version: '1.0' })).toBe('update:a@1.0')
    expect(workflowOperationLabel({ type: 'delete', key: 'a' })).toBe('delete:a')
  })

  it('finds items by key or template id and derives display names', () => {
    expect(findWorkflowItem([item], 'tpl-1')).toBe(item)
    expect(findWorkflowItem([item], 'send_message')).toBe(item)
    expect(findWorkflowItem([item], 'missing')).toBeUndefined()
    expect(workflowItemName(item)).toBe('Send message')
    expect(workflowItemName({ key: 'bare', versions: [] })).toBe('bare')
    expect(hasDraftVersion(item)).toBe(true)
  })
})
