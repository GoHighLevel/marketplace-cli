import { promises as fs } from 'node:fs'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliConfig } from '../../../../src/lib/config/environment.js'
import { createMcpServer } from '../../../../src/lib/mcp/server.js'
import { releaseToolset } from '../../../../src/lib/mcp/tools/release.js'
import { completeAppVersion } from '../../../helpers/app-files.js'
import { connectClient, textOf } from '../../../helpers/mcp-client.js'
import { API, portalConfig, routePortal, signIn } from '../../../helpers/portal.js'

let config: CliConfig
let client: Client

const draft = completeAppVersion({ private: true })
function appRoutes(versions: Array<Record<string, string>>, extra: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/app?skip=0&limit=100`]: {
      apps: [{ _id: 'version-1', appId: 'app-1', name: 'Acme CRM' }],
      totalCount: 1
    },
    [`GET ${API}/app/app-1/versions/latest`]: draft,
    [`GET ${API}/app/app-1/versions/version-1`]: draft,
    [`GET ${API}/app/versions?appId=app-1`]: versions,
    [`GET ${API}/app/app-1/version-1/pre-submit-validation`]: { success: true, mandatoryFields: { name: true } },
    ...extra
  }
}

const release = (args: Record<string, unknown>) =>
  client.callTool({ name: 'release-app', arguments: { appId: 'app-1', ...args } })

beforeEach(async () => {
  config = await portalConfig()
  await signIn(config)
  client = await connectClient(createMcpServer({ version: '1.0.0', toolsets: [releaseToolset(config)] }))
})

afterEach(async () => {
  await client.close()
  await fs.rm(config.configDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('release-app', () => {
  it('publishes the first version of a private app as 1.0.0', async () => {
    const fetch = routePortal(
      appRoutes([{ _id: 'version-1', version: 'draft', status: 'draft' }], {
        [`POST ${API}/app/app-1/versions/version-1/publish`]: {}
      })
    )
    vi.stubGlobal('fetch', fetch)

    expect(textOf(await release({ action: 'publish' }))).toBe(
      'Published "Acme CRM" 1.0.0; it is live for new installs.'
    )
    const publish = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(publish?.[1]?.body))).toEqual({
      newVersion: '1.0.0',
      agencyNotes: '',
      subAccountNotes: ''
    })
  })

  it('asks for release notes and lists the allowed versions instead of guessing', async () => {
    vi.stubGlobal(
      'fetch',
      routePortal(
        appRoutes(
          [
            { _id: 'version-1', version: '1.1.0', status: 'draft' },
            { _id: 'version-0', version: '1.0.0', status: 'live' }
          ],
          { [`GET ${API}/app/app-1/versions/version-1/analyze`]: { suggestedVersion: '1.1.0', updateType: 'minor' } }
        )
      )
    )
    expect(textOf(await release({ action: 'publish' }))).toBe(
      'INVALID_INPUT: Release notes for agencies are required to publish 1.1.0. Allowed versions: 1.1.0 (minor, suggested), 2.0.0 (major).'
    )
  })

  it('withdraws the version in review back to a draft', async () => {
    const inReview = completeAppVersion({ _id: 'version-2', version: '2.0.0', status: 'in review' })
    const fetch = routePortal(
      appRoutes(
        [
          { _id: 'version-2', version: '2.0.0', status: 'in review' },
          { _id: 'version-1', version: '1.0.0', status: 'live' }
        ],
        {
          [`GET ${API}/app/app-1/versions/version-2`]: inReview,
          [`POST ${API}/app/app-1/versions/version-2/withdrawReview`]: {}
        }
      )
    )
    vi.stubGlobal('fetch', fetch)

    expect(textOf(await release({ action: 'withdraw' }))).toBe(
      'Withdrew "Acme CRM" 2.0.0 from review; it is a draft again.'
    )
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('schedules deprecation of an older live version and creates drafts from the latest', async () => {
    const versions = [
      { _id: 'version-2', version: '2.0.0', status: 'live' },
      { _id: 'version-1', version: '1.0.0', status: 'live' }
    ]
    const live = (id: string, version: string) => completeAppVersion({ _id: id, version, status: 'live' })
    vi.stubGlobal(
      'fetch',
      routePortal({
        ...appRoutes(versions, {
          [`GET ${API}/app/app-1/versions/version-1`]: live('version-1', '1.0.0'),
          [`GET ${API}/app/app-1/versions/version-2`]: live('version-2', '2.0.0'),
          [`POST ${API}/app/app-1/versions/version-1/scheduleDeprecation`]: {},
          [`GET ${API}/app/app-1/versions/latest?isLive=true`]: live('version-2', '2.0.0'),
          [`POST ${API}/app/app-1/versions/version-2/cloneAsDraft`]: { id: 'version-3' }
        })
      })
    )

    expect(
      textOf(await release({ action: 'deprecate', version: '1.0.0', date: '2999-01-01', notes: 'Replaced by 2.0.0' }))
    ).toMatch(/^Scheduled deprecation of "Acme CRM" 1\.0\.0 on 2999-01-01 \(.+\)\.$/)
    expect(textOf(await release({ action: 'create-draft' }))).toBe(
      'Created draft version-3 from live 2.0.0. pull-app with version version-3 edits it locally.'
    )
  })

  it('explains what withdraw and deprecate need before acting', async () => {
    vi.stubGlobal('fetch', routePortal(appRoutes([{ _id: 'version-1', version: '1.0.0', status: 'live' }])))
    expect(textOf(await release({ action: 'withdraw' }))).toBe('INVALID_STATE: No version of "Acme CRM" is in review.')
    expect(textOf(await release({ action: 'deprecate', version: '1.0.0' }))).toBe(
      'INVALID_INPUT: deprecate needs version (the live version), date, and notes.'
    )
    expect((await release({ action: 'deprecate', date: '31-12-2026' })).isError).toBe(true)
  })

  it('rejects deprecation input before calling the portal', async () => {
    const fetch = routePortal({})
    vi.stubGlobal('fetch', fetch)
    expect(textOf(await release({ action: 'deprecate', version: '1.0.0' }))).toBe(
      'INVALID_INPUT: deprecate needs version (the live version), date, and notes.'
    )
    expect(textOf(await release({ action: 'deprecate', version: '1.0.0', date: '2000-01-01', notes: 'Old' }))).toMatch(
      /^INVALID_INPUT: .*at least 3 days/
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('release-workflow-module', () => {
  it('needs a change log to publish before calling the portal', async () => {
    const fetch = routePortal({})
    vi.stubGlobal('fetch', fetch)
    const result = await client.callTool({
      name: 'release-workflow-module',
      arguments: { directory: config.configDir, action: 'publish', kind: 'action', key: 'send_sms' }
    })
    expect(textOf(result)).toBe('INVALID_INPUT: publish needs notes: the release change log.')
    expect(fetch).not.toHaveBeenCalled()
  })
})
