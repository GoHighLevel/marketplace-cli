import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readLocalAppWorkspace } from '../../../src/lib/app/local-workspace.js'
import { writeAppWorkspace } from '../../../src/lib/app/workspace.js'
import { completeAppVersion } from '../../helpers/app-files.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-app-local-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('readLocalAppWorkspace', () => {
  it('loads an app without creating or requiring an empty webhook directory', async () => {
    const directory = path.join(root, 'without-webhooks')
    const result = await writeAppWorkspace({
      directory,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })

    const workspace = await readLocalAppWorkspace(directory)

    expect(result.webhookFile).toBeUndefined()
    await expect(fs.stat(path.dirname(workspace.webhookFile))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(workspace.files.webhooks).toEqual({
      schemaVersion: 1,
      appId: 'app-1',
      versionId: 'version-1',
      webhookUrl: '',
      subscribedEvents: []
    })
  })

  it('loads the generated manifests and their exact pull baseline', async () => {
    const directory = path.join(root, 'acme')
    await writeAppWorkspace({ directory, version: completeAppVersion() })

    const workspace = await readLocalAppWorkspace(directory)

    expect(workspace.directory).toBe(directory)
    expect(workspace.files).toEqual(workspace.state.baseline)
    expect(workspace.files.app.appId).toBe('app-1')
  })

  it('requires pull state before a workspace can be validated or pushed', async () => {
    const directory = path.join(root, 'acme')
    const result = await writeAppWorkspace({ directory, version: completeAppVersion() })
    await fs.unlink(result.stateFile)

    await expect(readLocalAppWorkspace(directory)).rejects.toThrow(/missing.*pull.*ghl app pull/i)
  })

  it('rejects symlinked managed files instead of reading outside the workspace', async () => {
    const directory = path.join(root, 'acme')
    const result = await writeAppWorkspace({ directory, version: completeAppVersion() })
    const outside = path.join(root, 'outside.json')
    await fs.writeFile(outside, '{}')
    await fs.unlink(result.webhookFile!)
    await fs.symlink(outside, result.webhookFile!)

    await expect(readLocalAppWorkspace(directory)).rejects.toThrow(/webhook.*symbolic link/i)
  })

  it('rejects oversized managed JSON before parsing it', async () => {
    const directory = path.join(root, 'acme')
    const result = await writeAppWorkspace({ directory, version: completeAppVersion() })
    await fs.writeFile(result.appFile, ' '.repeat(2 * 1024 * 1024 + 1))

    await expect(readLocalAppWorkspace(directory)).rejects.toThrow(/ghl-app\.json.*too large/i)
  })
})
