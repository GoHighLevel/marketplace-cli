import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ExternalAuthManifest } from '../../../src/lib/external-auth/manifest.js'
import {
  EXTERNAL_AUTH_CONFIG_RELATIVE_PATH,
  EXTERNAL_AUTH_DIRECTORY_RELATIVE_PATH,
  EXTERNAL_AUTH_GUIDE_FILENAME,
  EXTERNAL_AUTH_STATE_RELATIVE_PATH,
  loadExternalAuthWorkspace,
  writeExternalAuthWorkspace
} from '../../../src/lib/external-auth/workspace.js'

const directories: string[] = []

async function createAppWorkspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-external-auth-'))
  directories.push(directory)
  await fs.writeFile(path.join(directory, 'ghl-app.json'), JSON.stringify({
    schemaVersion: 1,
    appId: 'app-1',
    versionId: 'version-1',
    status: 'draft'
  }))
  return directory
}

function manifest(): ExternalAuthManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    versionId: 'version-1',
    enabled: true,
    updateAllRefreshTokens: false,
    type: 'oauth2',
    fields: [],
    requestConfig: {
      url: 'https://api.example.com/me',
      method: 'GET',
      urlParams: [],
      headers: [{ key: 'Authorization', value: 'Bearer {{bundle.accessToken}}' }],
      body: []
    },
    capabilities: { hasWhoAmIApi: false, multiAuthEnabled: false },
    oauth2: {
      externalAppName: 'Example',
      clientId: '${remote}',
      clientSecret: '${remote}',
      scopes: 'read',
      pkceEnabled: false,
      authorizationUrlConfig: {
        url: 'https://accounts.example.com/authorize',
        method: 'GET',
        urlParams: [],
        headers: [],
        body: []
      },
      accessTokenConfig: {
        url: 'https://accounts.example.com/token',
        method: 'POST',
        urlParams: [],
        headers: [],
        body: []
      },
      isAutoRefreshTokenEnabled: false,
      userInfoSameAsRequestConfig: false
    }
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('external-auth workspace', () => {
  it('writes a public redacted manifest, guide, and private redacted baseline', async () => {
    const directory = await createAppWorkspace()
    const value = manifest()
    value.capabilities = { hasWhoAmIApi: true, multiAuthEnabled: true }
    value.oauth2!.userInfoSameAsRequestConfig = true
    value.oauth2!.userInfoMapping = { id: 'data.id', name: 'data.name', email: '' }
    const result = await writeExternalAuthWorkspace(directory, value, value, {
      hasWhoAmIApiDisableLocked: true,
      multiAuthEnabledDisableLocked: true
    })

    expect(result.configFile).toBe(path.join(directory, EXTERNAL_AUTH_CONFIG_RELATIVE_PATH))
    expect(result.guideFile).toBe(path.join(directory, EXTERNAL_AUTH_DIRECTORY_RELATIVE_PATH, EXTERNAL_AUTH_GUIDE_FILENAME))
    expect(result.stateFile).toBe(path.join(directory, EXTERNAL_AUTH_STATE_RELATIVE_PATH))
    expect((await fs.stat(result.configFile)).mode & 0o777).toBe(0o644)
    expect((await fs.stat(result.stateFile)).mode & 0o777).toBe(0o600)
    expect(await fs.readFile(result.guideFile, 'utf8')).toMatch(/\$\{env:NAME\}.*\$\{remote\}/s)

    const loaded = await loadExternalAuthWorkspace(path.dirname(result.configFile))
    expect(loaded.manifest).toEqual(value)
    expect(loaded.state.baseline).toEqual(value)
    expect(loaded.state.capabilityLocks.hasWhoAmIApiDisableLocked).toBe(true)
  })

  it('requires initialized conflict state and matching app/version bindings', async () => {
    const directory = await createAppWorkspace()
    await expect(loadExternalAuthWorkspace(directory)).rejects.toThrow(/external-auth pull.*before editing/i)

    const value = manifest()
    value.versionId = 'other-version'
    await expect(writeExternalAuthWorkspace(directory, value)).rejects.toThrow(/other-version.*version-1/i)
  })

  it('rejects symlinks and unexpected JSON files in the managed directory', async () => {
    const directory = await createAppWorkspace()
    await writeExternalAuthWorkspace(directory, manifest())
    const configFile = path.join(directory, EXTERNAL_AUTH_CONFIG_RELATIVE_PATH)
    await fs.unlink(configFile)
    await fs.symlink(path.join(directory, 'ghl-app.json'), configFile)
    await expect(loadExternalAuthWorkspace(directory)).rejects.toThrow(/symbolic link/i)

    await fs.unlink(configFile)
    await fs.writeFile(configFile, JSON.stringify(manifest()))
    await fs.writeFile(path.join(directory, EXTERNAL_AUTH_DIRECTORY_RELATIVE_PATH, 'credentials.json'), '{}')
    await expect(loadExternalAuthWorkspace(directory)).rejects.toThrow(/credentials\.json.*not supported/i)
  })
})
