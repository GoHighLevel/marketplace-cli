import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { JSON_SCHEMA_REFERENCES } from '../../../../src/lib/app/json-schema.js'
import {
  toWorkflowActionUpdateBody,
  WorkflowActionsManifest
} from '../../../../src/lib/workflows/actions/manifest.js'
import {
  loadWorkflowActionsWorkspace,
  WORKFLOW_ACTION_CODE_DIRECTORY_RELATIVE_PATH,
  WORKFLOW_ACTION_CODE_MAX_BYTES,
  workflowActionFilenameFromKey,
  workflowActionKeyFromFilename,
  WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH,
  WORKFLOW_ACTIONS_GUIDE_FILENAME,
  WORKFLOW_ACTIONS_STATE_RELATIVE_PATH,
  writeWorkflowActionsWorkspace
} from '../../../../src/lib/workflows/actions/workspace.js'

const directories: string[] = []

function action(key: string, name: string, templateId?: string): WorkflowActionsManifest['actions'][number] {
  return {
    ...(templateId ? { templateId } : {}),
    key,
    versions: [{ version: '1.0', status: 'draft', info: { name } }]
  }
}

async function workspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-actions-workspace-'))
  directories.push(directory)
  await fs.writeFile(
    path.join(directory, 'ghl-app.json'),
    JSON.stringify({ schemaVersion: 1, appId: 'app-1', versionId: 'version-1' })
  )
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('workflow action filenames', () => {
  it('maps lowercase JSON filenames to stable underscore keys in both directions', () => {
    expect(workflowActionKeyFromFilename('send-contact-sync-payload.json')).toBe('send_contact_sync_payload')
    expect(workflowActionFilenameFromKey('send_contact_sync_payload')).toBe('send-contact-sync-payload.json')
    expect(workflowActionFilenameFromKey('sync__contact')).toBe('sync--contact.json')
  })

  it.each([
    'Send-contact.json',
    'send_contact.json',
    '-send-contact.json',
    'send-contact-.json',
    'send.contact.json',
    'send-contact.txt'
  ])('rejects unsupported action filename %s', filename => {
    expect(() => workflowActionKeyFromFilename(filename)).toThrow(/lowercase.*letters.*numbers.*hyphens.*\.json/i)
  })

  it('rejects platform-reserved and filesystem-unsafe action filenames', () => {
    expect(() => workflowActionKeyFromFilename('con.json')).toThrow(/reserved/i)
    expect(() => workflowActionKeyFromFilename(`${'a'.repeat(251)}.json`)).toThrow(/at most 250/i)
    expect(() => workflowActionFilenameFromKey('lpt1')).toThrow(/reserved/i)
  })
})

describe('workflow action workspaces', () => {
  it('writes one source file per action and reloads a combined in-memory manifest', async () => {
    const directory = await workspace()
    const manifest: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [
        action('sync_contact', 'Sync contact', 'template-2'),
        action('send_message', 'Send message', 'template-1')
      ]
    }
    const result = await writeWorkflowActionsWorkspace(directory, manifest)

    expect(result.actionDirectory).toBe(path.join(directory, WORKFLOW_ACTIONS_DIRECTORY_RELATIVE_PATH))
    expect(result.actionFiles).toEqual([
      path.join(result.actionDirectory, 'send-message.json'),
      path.join(result.actionDirectory, 'sync-contact.json')
    ])
    expect(result.guideFile).toBe(path.join(result.actionDirectory, WORKFLOW_ACTIONS_GUIDE_FILENAME))
    expect(result.stateFile).toBe(path.join(directory, WORKFLOW_ACTIONS_STATE_RELATIVE_PATH))

    const sendMessageFile = JSON.parse(await fs.readFile(result.actionFiles[0], 'utf8'))
    expect(sendMessageFile).toEqual({
      $schema: JSON_SCHEMA_REFERENCES['workflow-action'],
      schemaVersion: 1,
      key: 'send_message',
      templateId: 'template-1',
      versions: [{ version: '1.0', status: 'draft', info: { name: 'Send message' } }]
    })
    expect(await fs.readFile(result.guideFile, 'utf8')).toMatch(/filename.*send-contact-sync-payload\.json.*send_contact_sync_payload/is)
    expect(await fs.readFile(result.guideFile, 'utf8')).toMatch(
      /code\/<action-key>\.<major>\.<minor>\.js[\s\S]*without executing[\s\S]*inline `code`/i
    )
    expect(await fs.readFile(path.join(directory, 'HIGHLEVEL_APP.md'), 'utf8')).toMatch(
      /src\/modules\/workflows\/actions.*one JSON file per action/is
    )
    const loaded = await loadWorkflowActionsWorkspace(path.join(directory, 'src', 'modules', 'workflows'))
    expect(loaded.directory).toBe(directory)
    expect(loaded.manifest.actions.map(item => item.key)).toEqual(['send_message', 'sync_contact'])
    expect(loaded.state.baseline).toEqual(manifest)
    expect((await fs.stat(result.actionFiles[0])).mode & 0o777).toBe(0o644)
    expect((await fs.stat(result.stateFile)).mode & 0o777).toBe(0o600)
  })

  it('discovers a manually added action file and derives its key from the filename', async () => {
    const directory = await workspace()
    const empty: WorkflowActionsManifest = { schemaVersion: 1, appId: 'app-1', actions: [] }
    const result = await writeWorkflowActionsWorkspace(directory, empty)
    await fs.mkdir(result.actionDirectory, { recursive: true })
    await fs.writeFile(
      path.join(result.actionDirectory, 'my-workflow-action.json'),
      JSON.stringify({
        schemaVersion: 1,
        key: 'my_workflow_action',
        versions: [{ version: '1.0', status: 'draft', info: { name: 'My workflow action' } }]
      })
    )

    const loaded = await loadWorkflowActionsWorkspace(directory)
    expect(loaded.manifest.actions).toEqual([
      action('my_workflow_action', 'My workflow action')
    ])
  })

  it('keeps only the hidden baseline when there are no workflow actions', async () => {
    const directory = await workspace()
    const result = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: []
    })

    await expect(fs.stat(result.actionDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(result.codeDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(result.guideFile)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await loadWorkflowActionsWorkspace(directory)).manifest.actions).toEqual([])
  })

  it('removes generated action output when a later pull has no actions', async () => {
    const directory = await workspace()
    const first = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [action('send_message', 'Send message')]
    })
    await expect(fs.stat(first.actionDirectory)).resolves.toBeDefined()

    const empty = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: []
    })

    await expect(fs.stat(empty.actionDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await loadWorkflowActionsWorkspace(directory)).state.baseline.actions).toEqual([])
  })

  it('stores every code-backed action version in a deterministic JavaScript file', async () => {
    const directory = await workspace()
    const manifest: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [{
        templateId: 'template-1',
        key: 'calculate_score',
        versions: [
          {
            version: '1.1',
            status: 'draft',
            info: { name: 'Calculate score' },
            executionConfig: { type: 'CODE', code: 'const value = await Promise.resolve(42)\nreturn { value }' }
          },
          {
            version: '1.0',
            status: 'published',
            info: { name: 'Calculate score' },
            executionConfig: { type: 'CODE', code: 'return { value: 10 }' }
          }
        ]
      }]
    }

    const result = await writeWorkflowActionsWorkspace(directory, manifest)
    expect(result.codeDirectory).toBe(path.join(directory, WORKFLOW_ACTION_CODE_DIRECTORY_RELATIVE_PATH))
    expect(result.codeFiles).toEqual([
      path.join(result.codeDirectory, 'calculate_score.1.0.js'),
      path.join(result.codeDirectory, 'calculate_score.1.1.js')
    ])
    expect(await fs.readFile(result.codeFiles[0], 'utf8')).toBe('return { value: 10 }')
    expect(await fs.readFile(result.codeFiles[1], 'utf8')).toBe(
      'const value = await Promise.resolve(42)\nreturn { value }'
    )

    const source = JSON.parse(await fs.readFile(result.actionFiles[0], 'utf8'))
    expect(source.versions[0].executionConfig).toEqual({
      type: 'CODE',
      codeFile: 'code/calculate_score.1.1.js'
    })
    expect(source.versions[1].executionConfig).toEqual({
      type: 'CODE',
      codeFile: 'code/calculate_score.1.0.js'
    })
    expect(JSON.stringify(source)).not.toContain('"code":')

    const loaded = await loadWorkflowActionsWorkspace(directory)
    expect(loaded.manifest).toEqual(manifest)
    expect(loaded.codeFiles).toEqual(result.codeFiles)
    const apiBody = toWorkflowActionUpdateBody(loaded.manifest.actions[0].versions[0])
    expect(apiBody.executionConfig?.code).toBe('const value = await Promise.resolve(42)\nreturn { value }')
    expect(apiBody.executionConfig).not.toHaveProperty('codeFile')
    expect((await fs.stat(result.codeDirectory)).mode & 0o777).toBe(0o755)
    expect((await fs.stat(result.codeFiles[0])).mode & 0o777).toBe(0o644)
  })

  it('round-trips malformed legacy code for immutable published versions', async () => {
    const directory = await workspace()
    const legacyCode = '{\n"legacy": true\n}'
    const manifest: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [{
        templateId: 'template-1',
        key: 'legacy_action',
        versions: [{
          version: '1.0',
          status: 'published',
          info: { name: 'Legacy action' },
          executionConfig: { type: 'CODE', code: legacyCode }
        }]
      }]
    }

    const result = await writeWorkflowActionsWorkspace(directory, manifest)

    expect(await fs.readFile(result.codeFiles[0], 'utf8')).toBe(legacyCode)
    expect((await loadWorkflowActionsWorkspace(directory)).manifest).toEqual(manifest)
  })

  it('validates JavaScript files before validating the complete action', async () => {
    const directory = await workspace()
    const manifest: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [{
        key: 'calculate_score',
        versions: [{
          version: '1.0',
          status: 'draft',
          info: { name: 'Calculate score' },
          executionConfig: { type: 'CODE', code: 'return { value: 10 }' }
        }]
      }]
    }
    const result = await writeWorkflowActionsWorkspace(directory, manifest)
    await fs.writeFile(result.codeFiles[0], 'const result = ;')
    const source = JSON.parse(await fs.readFile(result.actionFiles[0], 'utf8'))
    source.versions[0].info = {}
    await fs.writeFile(result.actionFiles[0], JSON.stringify(source))

    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(
      /workflow action code is invalid[\s\S]*calculate_score\.1\.0\.js:1[\s\S]*unexpected token/i
    )
  })

  it('rejects missing, non-canonical, inline, and orphaned code sources', async () => {
    const directory = await workspace()
    const manifest: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [{
        key: 'calculate_score',
        versions: [{
          version: '1.0',
          status: 'draft',
          info: { name: 'Calculate score' },
          executionConfig: { type: 'CODE', code: 'return { value: 10 }' }
        }]
      }]
    }
    const result = await writeWorkflowActionsWorkspace(directory, manifest)
    const source = JSON.parse(await fs.readFile(result.actionFiles[0], 'utf8'))

    await fs.unlink(result.codeFiles[0])
    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/calculate_score\.1\.0\.js.*does not exist/i)

    await fs.writeFile(result.codeFiles[0], 'return {}')
    source.versions[0].executionConfig.codeFile = '../outside.js'
    await fs.writeFile(result.actionFiles[0], JSON.stringify(source))
    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/codeFile.*must be "code\/calculate_score\.1\.0\.js"/i)

    source.versions[0].executionConfig = { type: 'CODE', code: 'return {}' }
    await fs.writeFile(result.actionFiles[0], JSON.stringify(source))
    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/inline.*code.*codeFile/i)

    source.versions[0].executionConfig = { type: 'CODE', codeFile: 'code/calculate_score.1.0.js' }
    await fs.writeFile(result.actionFiles[0], JSON.stringify(source))
    await fs.writeFile(path.join(result.codeDirectory, 'unused_action.1.0.js'), 'return {}')
    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/unused_action\.1\.0\.js.*not referenced/i)
  })

  it('keeps API and CODE execution configuration mutually exclusive', async () => {
    const directory = await workspace()
    const apiManifest: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [{
        key: 'execute_action',
        versions: [{
          version: '1.0',
          status: 'draft',
          info: { name: 'Execute action' },
          executionConfig: {
            type: 'API',
            url: 'https://api.example.com/actions/execute',
            method: 'POST'
          }
        }]
      }]
    }
    const result = await writeWorkflowActionsWorkspace(directory, apiManifest)
    const source = JSON.parse(await fs.readFile(result.actionFiles[0], 'utf8'))
    source.versions[0].executionConfig.codeFile = 'code/execute_action.1.0.js'
    await fs.writeFile(result.actionFiles[0], JSON.stringify(source))

    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(
      /executionConfig\.codeFile is only supported when type is "CODE"/i
    )

    delete source.versions[0].executionConfig.codeFile
    source.versions[0].executionConfig.code = 'return {}'
    await fs.writeFile(result.actionFiles[0], JSON.stringify(source))
    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(
      /executionConfig\.code is only supported when type is "CODE"/i
    )

    source.versions[0].executionConfig = {
      type: 'CODE',
      codeFile: 'code/execute_action.1.0.js',
      url: 'https://api.example.com/actions/execute',
      method: 'POST',
      headers: { Accept: 'application/json' }
    }
    await fs.mkdir(result.codeDirectory, { recursive: true })
    await Promise.all([
      fs.writeFile(result.actionFiles[0], JSON.stringify(source)),
      fs.writeFile(path.join(result.codeDirectory, 'execute_action.1.0.js'), 'return {}')
    ])

    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(
      /executionConfig\.url is only supported when type is "API"[\s\S]*method is only supported[\s\S]*headers is only supported/i
    )
  })

  it('rejects unsafe or oversized JavaScript files', async () => {
    const directory = await workspace()
    const manifest: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [{
        key: 'calculate_score',
        versions: [{
          version: '1.0',
          status: 'draft',
          info: { name: 'Calculate score' },
          executionConfig: { type: 'CODE', code: 'return {}' }
        }]
      }]
    }
    const result = await writeWorkflowActionsWorkspace(directory, manifest)
    const target = path.join(directory, 'linked-code.js')
    await fs.writeFile(target, 'return {}')
    await fs.unlink(result.codeFiles[0])
    await fs.symlink(target, result.codeFiles[0])
    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/calculate_score\.1\.0\.js.*symbolic link/i)

    await fs.unlink(result.codeFiles[0])
    await fs.writeFile(result.codeFiles[0], Buffer.alloc(WORKFLOW_ACTION_CODE_MAX_BYTES + 1, 0x20))
    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/calculate_score\.1\.0\.js.*at most.*MiB/i)

    await fs.writeFile(result.codeFiles[0], Buffer.from([0xc3, 0x28]))
    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/calculate_score\.1\.0\.js.*valid UTF-8/i)
  })

  it('removes stale managed JavaScript while preserving unrelated code-directory files', async () => {
    const directory = await workspace()
    const codeAction: WorkflowActionsManifest['actions'][number] = {
      key: 'calculate_score',
      versions: [{
        version: '1.0',
        status: 'draft',
        info: { name: 'Calculate score' },
        executionConfig: { type: 'CODE', code: 'return {}' }
      }]
    }
    const first = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [codeAction]
    })
    const notes = path.join(first.codeDirectory, 'README.md')
    await fs.writeFile(notes, 'Keep me')

    const second = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [action('api_action', 'API action')]
    })

    await expect(fs.stat(path.join(second.codeDirectory, 'calculate_score.1.0.js'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(notes, 'utf8')).resolves.toBe('Keep me')
  })

  it('reports invalid filenames and file configuration before authentication', async () => {
    const directory = await workspace()
    const result = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: []
    })
    await fs.mkdir(result.actionDirectory, { recursive: true })
    await fs.writeFile(
      path.join(result.actionDirectory, 'Bad_action.json'),
      JSON.stringify({ schemaVersion: 2, key: 'ignored', versions: [] })
    )

    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/Bad_action\.json.*lowercase/i)
  })

  it('requires a key property in every action file', async () => {
    const directory = await workspace()
    const result = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: []
    })
    await fs.mkdir(result.actionDirectory, { recursive: true })
    await fs.writeFile(
      path.join(result.actionDirectory, 'send-message.json'),
      JSON.stringify({
        schemaVersion: 1,
        versions: [{ version: '1.0', status: 'draft', info: { name: 'Send message' } }]
      })
    )

    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/send-message\.json\.key must be a non-empty string/i)
  })

  it('requires the JSON key to match the filename-derived key', async () => {
    const directory = await workspace()
    const result = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: []
    })
    await fs.mkdir(result.actionDirectory, { recursive: true })
    await fs.writeFile(
      path.join(result.actionDirectory, 'send-message.json'),
      JSON.stringify({
        schemaVersion: 1,
        key: 'different_key',
        versions: [{ version: '1.0', status: 'draft', info: { name: 'Send message' } }]
      })
    )

    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(
      /send-message\.json\.key "different_key" must match the filename-derived key "send_message"/i
    )
  })

  it('removes stale managed JSON files while preserving documentation and unrelated files', async () => {
    const directory = await workspace()
    const first = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [action('first_action', 'First'), action('second_action', 'Second')]
    })
    const notesFile = path.join(first.actionDirectory, 'NOTES.md')
    await fs.writeFile(notesFile, 'Keep me')

    const second = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [action('second_action', 'Second')]
    })

    await expect(fs.stat(path.join(second.actionDirectory, 'first-action.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(notesFile, 'utf8')).resolves.toBe('Keep me')
    await expect(fs.readFile(second.guideFile, 'utf8')).resolves.toMatch(/HighLevel Workflow Actions/)
  })

  it('rejects symlinked action files', async () => {
    const directory = await workspace()
    const result = await writeWorkflowActionsWorkspace(directory, {
      schemaVersion: 1,
      appId: 'app-1',
      actions: []
    })
    await fs.mkdir(result.actionDirectory, { recursive: true })
    const target = path.join(directory, 'outside.json')
    await fs.writeFile(target, '{}')
    await fs.symlink(target, path.join(result.actionDirectory, 'linked-action.json'))

    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/symbolic link/i)
  })

  it('rejects the legacy aggregate file instead of silently ignoring local changes', async () => {
    const directory = await workspace()
    await fs.mkdir(path.join(directory, 'src', 'modules', 'workflows'), { recursive: true })
    await fs.writeFile(
      path.join(directory, 'src', 'modules', 'workflows', 'workflow-actions.json'),
      JSON.stringify({ schemaVersion: 1, appId: 'app-1', actions: [] })
    )

    await expect(loadWorkflowActionsWorkspace(directory)).rejects.toThrow(/legacy.*workflow-actions\.json.*pull/i)
  })

  it('applies the app white-label setting before writing action configuration', async () => {
    const directory = await workspace()
    const branded: WorkflowActionsManifest = {
      schemaVersion: 1,
      appId: 'app-1',
      actions: [action('send_message', 'GHL message sender')]
    }

    await expect(writeWorkflowActionsWorkspace(directory, branded)).rejects.toThrow(/white-label/i)
  })
})
