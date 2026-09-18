import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { WORKFLOW_ACTIONS_RESOURCE } from '../../../../src/lib/workflows/actions/resource.js'
import { type WorkflowActionsManifest } from '../../../../src/lib/workflows/actions/manifest.js'
import {
  loadWorkflowActionsWorkspace,
  writeWorkflowActionsWorkspace
} from '../../../../src/lib/workflows/actions/workspace.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

const manifest: WorkflowActionsManifest = {
  schemaVersion: 1,
  appId: 'app-1',
  actions: [
    {
      templateId: 'tpl-1',
      key: 'send_message',
      versions: [{ version: '1.0', status: 'published', info: { name: 'Send message' } }]
    }
  ]
}

describe('WORKFLOW_ACTIONS_RESOURCE', () => {
  it('adds scaffolds in key order without mutating the manifest', () => {
    const next = WORKFLOW_ACTIONS_RESOURCE.withScaffold(manifest, 'Archive', 'archive_contact')
    expect(next.actions.map(action => action.key)).toEqual(['archive_contact', 'send_message'])
    expect(next.actions[0].versions[0]).toMatchObject({
      version: '1.0',
      status: 'draft',
      info: { name: 'Archive' },
      executionConfig: { type: 'CODE', code: '' }
    })
    expect(manifest.actions).toHaveLength(1)
  })

  it('removes items by key', () => {
    expect(WORKFLOW_ACTIONS_RESOURCE.withoutItem(manifest, 'send_message').actions).toEqual([])
  })

  it('maps registry summaries and publish candidates onto the shared shapes', () => {
    expect(
      WORKFLOW_ACTIONS_RESOURCE.summaryRow({
        _id: 'tpl-1',
        actionId: 'tpl-1',
        name: 'Send message',
        version: '1.0',
        status: 'published'
      })
    ).toEqual({ id: 'tpl-1', name: 'Send message', version: '1.0', status: 'published' })

    const candidates = WORKFLOW_ACTIONS_RESOURCE.publishCandidates(manifest, [
      { _id: 'tpl-1', actionId: 'tpl-1', name: 'Send message', version: '0.9', status: 'published' }
    ])
    expect(candidates).toEqual([
      { item: manifest.actions[0], version: manifest.actions[0].versions[0], repairRegistry: true }
    ])
  })

  it('translates shared validation options into action-specific ones', () => {
    const errors = WORKFLOW_ACTIONS_RESOURCE.validateManifest(manifest, { publishable: true, key: 'missing' })
    expect(errors).toContain('workflow-actions.json action "missing" was not found.')
    expect(WORKFLOW_ACTIONS_RESOURCE.validateManifest(manifest)).toEqual([])
  })

  it('exposes the written directory and the state-only file subset', () => {
    const files = {
      actionDirectory: '/w/actions',
      actionFiles: [],
      codeDirectory: '/w/actions/code',
      codeFiles: [],
      guideFile: '/w/actions/GUIDE.md',
      stateFile: '/w/.ghl/state.json'
    }
    expect(WORKFLOW_ACTIONS_RESOURCE.filesDirectory(files)).toBe('/w/actions')
    expect(WORKFLOW_ACTIONS_RESOURCE.stateFiles(files)).toEqual({ stateFile: '/w/.ghl/state.json' })
    expect(WORKFLOW_ACTIONS_RESOURCE.filenameFromKey('send_message')).toBe('send-message.json')
  })
})

describe('WORKFLOW_ACTIONS_RESOURCE staged sources', () => {
  it('stages a deletion by rewriting the remaining actions and keeping their code', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-actions-resource-'))
    directories.push(directory)
    await fs.writeFile(
      path.join(directory, 'ghl-app.json'),
      JSON.stringify({ schemaVersion: 1, appId: 'app-1', versionId: 'version-1' })
    )
    const initial: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [
        {
          templateId: 'tpl-1',
          key: 'keep_me',
          versions: [
            {
              version: '1.0',
              status: 'published',
              info: { name: 'Keep' },
              executionConfig: { type: 'CODE', code: 'return { kept: true }' }
            }
          ]
        },
        {
          templateId: 'tpl-2',
          key: 'remove_me',
          versions: [{ version: '1.0', status: 'draft', info: { name: 'Remove' } }]
        }
      ]
    }
    await writeWorkflowActionsWorkspace(directory, initial)
    const workspace = await loadWorkflowActionsWorkspace(directory)

    const staged = await WORKFLOW_ACTIONS_RESOURCE.writeStagedSources(
      workspace,
      WORKFLOW_ACTIONS_RESOURCE.withoutItem(initial, 'remove_me')
    )

    expect(staged.files.map(file => path.basename(file))).toEqual(['keep-me.json'])
    const reloaded = await loadWorkflowActionsWorkspace(directory)
    expect(reloaded.manifest.actions.map(action => action.key)).toEqual(['keep_me'])
    expect(reloaded.codeSources.map(source => source.compiledCode)).toEqual(['return { kept: true }'])
    expect(reloaded.state.baseline).toEqual(initial)
  })
})
