import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { JSON_SCHEMA_REFERENCES } from '../../../../src/lib/app/json-schema.js'
import { WorkflowTriggersManifest } from '../../../../src/lib/workflows/triggers/manifest.js'
import {
  loadWorkflowTriggersWorkspace,
  loadWorkflowTriggersWorkspaceIfPresent,
  workflowTriggerFilenameFromKey,
  workflowTriggerKeyFromFilename,
  WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH,
  WORKFLOW_TRIGGERS_STATE_RELATIVE_PATH,
  writeWorkflowTriggersWorkspace
} from '../../../../src/lib/workflows/triggers/workspace.js'

const directories: string[] = []

async function workspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-triggers-workspace-'))
  directories.push(directory)
  await fs.writeFile(path.join(directory, 'ghl-app.json'), JSON.stringify({
    schemaVersion: 1,
    appId: 'app-1',
    versionId: 'version-1',
    listing: { userTypes: ['Location'], isWhiteLabelFriendly: false },
    oauth: {
      allowedScopes: ['workflows.readonly'],
      redirectUris: ['https://example.com/oauth/callback'],
      clientKeys: [{ id: 'key-1', name: 'Default', isDefault: true }]
    }
  }))
  return directory
}

function manifest(): WorkflowTriggersManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    triggers: [{
      templateId: 'template-1',
      key: 'contact_changed',
      versions: [{
        version: '1.0',
        status: 'draft',
        info: { name: 'Contact changed' },
        customVarsJson: { contact: { id: 'contact-1' } },
        filters: [{ field: 'contact.id', title: 'Contact ID', fieldType: 'string', required: true }],
        customVars: [{ name: 'Contact ID', reference: 'contact.id', fieldType: 'string' }],
        subscriptionConfig: { url: 'https://example.com/subscriptions' }
      }]
    }]
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('workflow trigger filenames', () => {
  it('maps portable hyphenated filenames to underscore keys', () => {
    expect(workflowTriggerKeyFromFilename('contact-status-updated.json')).toBe('contact_status_updated')
    expect(workflowTriggerFilenameFromKey('contact_status_updated')).toBe('contact-status-updated.json')
  })

  it.each(['Contact.json', 'contact_status.json', '-contact.json', 'contact-.json', 'contact.txt'])(
    'rejects unsupported trigger filename %s',
    filename => expect(() => workflowTriggerKeyFromFilename(filename)).toThrow(/lowercase.*letters.*numbers.*hyphens.*\.json/i)
  )

  it('rejects reserved and overlong keys', () => {
    expect(() => workflowTriggerKeyFromFilename('con.json')).toThrow(/reserved/i)
    expect(() => workflowTriggerFilenameFromKey('lpt1')).toThrow(/reserved/i)
    expect(() => workflowTriggerKeyFromFilename(`${'a'.repeat(251)}.json`)).toThrow(/at most 250/i)
  })
})

describe('workflow trigger workspaces', () => {
  it('writes one file per trigger, state, guide, and reloads the aggregate manifest', async () => {
    const directory = await workspace()
    const result = await writeWorkflowTriggersWorkspace(directory, manifest())

    expect(result.triggerDirectory).toBe(path.join(directory, WORKFLOW_TRIGGERS_DIRECTORY_RELATIVE_PATH))
    expect(result.triggerFiles).toEqual([path.join(result.triggerDirectory, 'contact-changed.json')])
    expect(result.triggerStateFile).toBe(path.join(directory, WORKFLOW_TRIGGERS_STATE_RELATIVE_PATH))
    expect(await fs.readFile(result.triggerGuideFile, 'utf8')).toMatch(/subscription callback/i)
    expect(JSON.parse(await fs.readFile(result.triggerFiles[0], 'utf8'))).toMatchObject({
      $schema: JSON_SCHEMA_REFERENCES['workflow-trigger'],
      schemaVersion: 1,
      key: 'contact_changed',
      templateId: 'template-1'
    })

    const loaded = await loadWorkflowTriggersWorkspace(path.join(directory, 'src', 'modules'))
    expect(loaded.manifest).toEqual(manifest())
    expect(loaded.redirectUris).toEqual(['https://example.com/oauth/callback'])
    expect(loaded.clientKeyCount).toBe(1)
    expect(loaded.userTypes).toEqual(['Location'])
    expect((await fs.stat(result.triggerFiles[0])).mode & 0o777).toBe(0o644)
    expect((await fs.stat(result.triggerStateFile)).mode & 0o777).toBe(0o600)
  })

  it('discovers manually added trigger files and enforces filename-derived keys', async () => {
    const directory = await workspace()
    const empty: WorkflowTriggersManifest = { schemaVersion: 1, appId: 'app-1', triggers: [] }
    const result = await writeWorkflowTriggersWorkspace(directory, empty)
    await fs.mkdir(result.triggerDirectory, { recursive: true })
    const triggerFile = path.join(result.triggerDirectory, 'order-created.json')
    await fs.writeFile(triggerFile, JSON.stringify({
      schemaVersion: 1,
      key: 'order_created',
      versions: [{ version: '1.0', status: 'draft', info: { name: 'Order created' } }]
    }))
    expect((await loadWorkflowTriggersWorkspace(directory)).manifest.triggers[0].key).toBe('order_created')

    const invalid = JSON.parse(await fs.readFile(triggerFile, 'utf8'))
    invalid.key = 'wrong_key'
    await fs.writeFile(triggerFile, JSON.stringify(invalid))
    await expect(loadWorkflowTriggersWorkspace(directory)).rejects.toThrow(/must match the filename-derived key "order_created"/i)
  })

  it('keeps only the hidden baseline when there are no workflow triggers', async () => {
    const directory = await workspace()
    const result = await writeWorkflowTriggersWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      triggers: []
    })

    await expect(fs.stat(result.triggerDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(result.triggerGuideFile)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await loadWorkflowTriggersWorkspace(directory)).manifest.triggers).toEqual([])
  })

  it('removes generated trigger output when a later pull has no triggers', async () => {
    const directory = await workspace()
    const first = await writeWorkflowTriggersWorkspace(directory, manifest())
    await expect(fs.stat(first.triggerDirectory)).resolves.toBeDefined()

    const empty = await writeWorkflowTriggersWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      triggers: []
    })

    await expect(fs.stat(empty.triggerDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await loadWorkflowTriggersWorkspace(directory)).state.baseline.triggers).toEqual([])
  })

  it('requires valid state and rejects unsafe or oversized managed files', async () => {
    const directory = await workspace()
    const result = await writeWorkflowTriggersWorkspace(directory, manifest())

    await fs.unlink(result.triggerStateFile)
    await expect(loadWorkflowTriggersWorkspace(directory)).rejects.toThrow(/workflow trigger state is missing/i)

    await writeWorkflowTriggersWorkspace(directory, manifest())
    await fs.writeFile(result.triggerFiles[0], 'x'.repeat(2 * 1024 * 1024 + 1))
    await expect(loadWorkflowTriggersWorkspace(directory)).rejects.toThrow(/too large.*2 MiB/i)
  })

  it('reports absence without treating a normal app workspace as malformed', async () => {
    const directory = await workspace()
    await expect(loadWorkflowTriggersWorkspaceIfPresent(directory)).resolves.toBeUndefined()
  })
})
