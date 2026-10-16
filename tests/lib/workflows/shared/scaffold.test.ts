import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WORKFLOW_ACTIONS_RESOURCE } from '../../../../src/lib/workflows/actions/resource.js'
import { scaffoldWorkflowItem } from '../../../../src/lib/workflows/shared/scaffold.js'
import { WORKFLOW_TRIGGERS_RESOURCE } from '../../../../src/lib/workflows/triggers/resource.js'
import { writeTestWorkspace } from '../../../helpers/workspace.js'

let directory: string

beforeEach(async () => {
  directory = await writeTestWorkspace(path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-scaffold-')), 'app'))
})

afterEach(async () => {
  await fs.rm(path.dirname(directory), { recursive: true, force: true })
})

describe('scaffoldWorkflowItem', () => {
  it('stages a typed action with its handler source, ready for the next push', async () => {
    const workspace = await WORKFLOW_ACTIONS_RESOURCE.loadWorkspace(directory)
    const created = await scaffoldWorkflowItem(WORKFLOW_ACTIONS_RESOURCE, workspace, {
      name: ' Send SMS ',
      key: 'send_sms',
      typescript: true
    })

    expect(created).toEqual({
      appId: 'app-1',
      key: 'send_sms',
      name: 'Send SMS',
      version: '1.0',
      file: path.join(directory, 'src', 'modules', 'workflows', 'actions', 'send-sms.json'),
      prerequisites: [
        'ghl-app.json.oauth.allowedScopes must include "workflows.readonly" before workflow actions can be pushed or published.'
      ]
    })
    const handler = path.join(path.dirname(created.file), 'code', 'send_sms.1.0.ts')
    await expect(fs.readFile(handler, 'utf8')).resolves.toContain('export default action')
    const reloaded = await WORKFLOW_ACTIONS_RESOURCE.loadWorkspace(directory)
    expect(reloaded.manifest.actions.map(action => action.key)).toEqual(['send_sms'])
    expect(reloaded.state.baseline.actions).toEqual([])
  })

  it('stages a trigger', async () => {
    const workspace = await WORKFLOW_TRIGGERS_RESOURCE.loadWorkspace(directory)
    const created = await scaffoldWorkflowItem(WORKFLOW_TRIGGERS_RESOURCE, workspace, {
      name: 'Contact scored',
      key: 'contact_scored'
    })
    expect(created.file).toBe(path.join(directory, 'src', 'modules', 'workflows', 'triggers', 'contact-scored.json'))
  })

  it('rejects a blank name, a malformed key, and a duplicate key before writing anything', async () => {
    const workspace = await WORKFLOW_ACTIONS_RESOURCE.loadWorkspace(directory)
    await expect(scaffoldWorkflowItem(WORKFLOW_ACTIONS_RESOURCE, workspace, { name: ' ', key: 'a' })).rejects.toThrow(
      'The action name is required.'
    )
    await expect(
      scaffoldWorkflowItem(WORKFLOW_ACTIONS_RESOURCE, workspace, { name: 'A', key: 'Send-SMS' })
    ).rejects.toThrow('Invalid action key "Send-SMS". Use lowercase letters, numbers, and underscores')

    await scaffoldWorkflowItem(WORKFLOW_ACTIONS_RESOURCE, workspace, { name: 'A', key: 'send_sms' })
    const updated = await WORKFLOW_ACTIONS_RESOURCE.loadWorkspace(directory)
    await expect(
      scaffoldWorkflowItem(WORKFLOW_ACTIONS_RESOURCE, updated, { name: 'B', key: 'send_sms' })
    ).rejects.toThrow(/duplicates action key "send_sms"/)
  })
})
