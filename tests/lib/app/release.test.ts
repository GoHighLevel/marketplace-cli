import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ApiClient } from '../../../src/lib/api/client.js'
import {
  createDraftFromLive,
  latestLiveVersion,
  preparePublish,
  type ReleaseTarget,
  resolvePublishRequest,
  validateDeprecationRequest
} from '../../../src/lib/app/release.js'
import { type CliConfig } from '../../../src/lib/config/environment.js'
import { getSelectedApp } from '../../../src/lib/config/selection-store.js'
import { completeAppVersion } from '../../helpers/app-files.js'

let dir: string
let config: CliConfig

function target(
  overrides: Partial<Record<keyof ApiClient, unknown>> = {},
  version = completeAppVersion()
): ReleaseTarget {
  const client = {
    activeProfileName: 'default',
    preSubmitValidation: vi.fn(async () => ({ success: true, mandatoryFields: { name: true } })),
    listVersions: vi.fn(async () => [{ _id: 'version-1', version: '1.0.0', status: 'draft' }]),
    analyzeVersion: vi.fn(async () => ({ suggestedVersion: '1.1.0', updateType: 'minor' })),
    ...overrides
  } as unknown as ApiClient
  return { client, config, selected: { appId: 'app-1', versionId: 'version-1', name: 'Acme CRM' }, version }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-release-'))
  config = { portalUrl: '', apiUrl: '', oauthUrl: '', workflowsUrl: '', configDir: dir }
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('preparePublish', () => {
  it('treats an app without a published version as a first release', async () => {
    await expect(preparePublish(target({}, completeAppVersion({ private: true })))).resolves.toEqual({
      isPrivate: true,
      options: []
    })
  })

  it('offers the allowed bumps of the live version and the suggested one', async () => {
    const release = target({
      listVersions: async () => [
        { _id: 'version-1', version: '1.1.0', status: 'draft' },
        { _id: 'version-0', version: '1.0.0', status: 'live' }
      ]
    })
    const preparation = await preparePublish(release)
    expect(preparation).toMatchObject({ baseVersion: '1.0.0', suggestedVersion: '1.1.0' })
    expect(preparation.options.map(option => option.version)).toEqual(['1.0.1', '1.1.0', '2.0.0'])
  })

  it('stops with the fix before any publish call', async () => {
    const missing = target({ preSubmitValidation: async () => ({ success: false, mandatoryFields: { logo: false } }) })
    await expect(preparePublish(missing)).rejects.toThrow(/Missing: logo/)

    const pending = target({
      listVersions: async () => [
        { _id: 'version-1', version: '1.1.0', status: 'draft' },
        { _id: 'version-2', version: '1.0.0', status: 'review' }
      ]
    })
    await expect(preparePublish(pending)).rejects.toThrow('Version 1.0.0 is already pending')
    await expect(preparePublish(target({}, completeAppVersion({ status: 'live' })))).rejects.toThrow(/must be draft/)
  })
})

describe('resolvePublishRequest', () => {
  const later = { isPrivate: false, baseVersion: '1.0.0', suggestedVersion: '1.1.0', options: [] as never[] }

  it('publishes a first release as 1.0.0 with optional notes', () => {
    expect(resolvePublishRequest({ isPrivate: true, options: [] }, {})).toEqual({
      newVersion: '1.0.0',
      agencyNotes: '',
      subAccountNotes: ''
    })
    expect(() => resolvePublishRequest({ isPrivate: true, options: [] }, { version: '2.0.0' })).toThrow(
      'The first published version is always 1.0.0.'
    )
  })

  it('defaults to the suggested version and requires agency notes for later releases', async () => {
    const options = (
      await preparePublish(
        target({
          listVersions: async () => [
            { _id: 'version-1', version: '1.1.0', status: 'draft' },
            { _id: 'version-0', version: '1.0.0', status: 'live' }
          ]
        })
      )
    ).options
    const preparation = { ...later, options }
    expect(resolvePublishRequest(preparation, { agencyNotes: 'Adds sync' })).toEqual({
      newVersion: '1.1.0',
      agencyNotes: 'Adds sync',
      subAccountNotes: ''
    })
    expect(() => resolvePublishRequest(preparation, {})).toThrow(
      'Release notes for agencies are required to publish 1.1.0.'
    )
    expect(() => resolvePublishRequest(preparation, { version: '3.0.0', agencyNotes: 'x' })).toThrow(
      /Version must be one of/
    )
  })
})

describe('deprecation and drafts', () => {
  it('validates the timezone, the date, and the notes', () => {
    const request = { date: '2999-01-01', timezone: 'UTC', notes: 'Superseded' }
    expect(validateDeprecationRequest(request)).toEqual(request)
    expect(() => validateDeprecationRequest({ ...request, timezone: 'Mars/Olympus' })).toThrow(/not a valid IANA/)
    expect(() => validateDeprecationRequest({ ...request, date: '2000-01-01' })).toThrow(/at least 3 days/)
    expect(() => validateDeprecationRequest({ ...request, notes: ' ' })).toThrow(/cannot be empty/)
    expect(() => validateDeprecationRequest({ ...request, date: '2000-01-01' })).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' })
    )
  })

  it('creates a draft from the live version and selects it', async () => {
    const release = target(
      {
        listVersions: async () => [{ _id: 'version-1', version: '1.0.0', status: 'live' }],
        cloneAsDraft: async () => ({ id: 'draft-1' })
      },
      completeAppVersion({ status: 'live' })
    )
    await expect(createDraftFromLive(release)).resolves.toBe('draft-1')
    expect(await getSelectedApp(dir, 'default')).toMatchObject({ appId: 'app-1', versionId: 'draft-1' })
  })

  it('names the versions when the app has nothing live', async () => {
    const release = target({ listVersions: async () => [{ _id: 'v', version: '1.0.0', status: 'deprecating' }] })
    await expect(latestLiveVersion(release.client, 'app-1')).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: 'The app has no live version (versions: 1.0.0 deprecating).'
    })
  })
})
