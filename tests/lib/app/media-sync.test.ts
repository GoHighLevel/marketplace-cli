import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '../../../src/lib/api/client.js'
import { uploadMedia } from '../../../src/lib/app/media-sync.js'
import type { AppContext } from '../../../src/lib/app/section-context.js'
import { completeAppVersion } from '../../helpers/app-files.js'
import { png } from '../../helpers/images.js'

let dir: string

function context(configDir: string, newVersionId?: string): AppContext {
  const client = {
    activeProfileName: 'default',
    uploadFiles: vi.fn(async () => ({ shot: 'https://cdn.example.com/new.png' })),
    deleteFiles: vi.fn(async () => undefined),
    updateProfileSection: vi.fn(async () => ({ oAuthClient: { _id: newVersionId ?? 'version-1', appId: 'app-1' } }))
  } as unknown as ApiClient
  return {
    client,
    config: { portalUrl: '', apiUrl: '', oauthUrl: '', workflowsUrl: '', configDir },
    selected: { appId: 'app-1', versionId: 'version-1' },
    version: completeAppVersion()
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-media-sync-'))
  await fs.writeFile(path.join(dir, 'shot.png'), png(900, 540))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('uploadMedia', () => {
  it('attaches screenshots and follows a move to a new draft', async () => {
    const media = context(dir, 'version-2')
    const uploaded = await uploadMedia(media, { files: [path.join(dir, 'shot.png')], logo: false, profile: 'agency' })
    expect(uploaded).toMatchObject({ urls: ['https://cdn.example.com/new.png'], total: 4 })
    expect(uploaded.notes).toEqual([expect.stringContaining('new draft version (version-2)')])
    expect(media.selected.versionId).toBe('version-2')
  })

  it('never deletes attached files when only following the new draft fails', async () => {
    const unwritable = path.join(dir, 'config-file')
    await fs.writeFile(unwritable, '')
    const media = context(unwritable, 'version-2')

    await expect(
      uploadMedia(media, { files: [path.join(dir, 'shot.png')], logo: false, profile: 'agency' })
    ).rejects.toThrow()
    expect(media.client.updateProfileSection).toHaveBeenCalledOnce()
    expect(media.client.deleteFiles).not.toHaveBeenCalled()
  })

  it('removes the uploaded files when the portal refuses to attach them', async () => {
    const media = context(dir)
    vi.mocked(media.client.updateProfileSection).mockRejectedValue(new Error('API request failed (400): refused'))
    await expect(
      uploadMedia(media, { files: [path.join(dir, 'shot.png')], logo: false, profile: 'agency' })
    ).rejects.toThrow('API request failed (400): refused The uploaded files were removed.')
    expect(media.client.deleteFiles).toHaveBeenCalledWith('app-1', ['https://cdn.example.com/new.png'])
  })
})
