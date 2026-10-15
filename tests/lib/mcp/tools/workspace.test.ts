import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliConfig } from '../../../../src/lib/config/environment.js'
import { getSelectedApp } from '../../../../src/lib/config/selection-store.js'
import { createMcpServer } from '../../../../src/lib/mcp/server.js'
import { nextAfterPush, workspaceToolset } from '../../../../src/lib/mcp/tools/workspace.js'
import { completeAppVersion } from '../../../helpers/app-files.js'
import { type ConfirmingUser, connectClient, textOf } from '../../../helpers/mcp-client.js'
import { API, OAUTH, portalConfig, routePortal, signIn, WORKFLOWS } from '../../../helpers/portal.js'
import { appManifest, editJson, writeTestWorkspace } from '../../../helpers/workspace.js'

let config: CliConfig
let client: Client
let directory: string

async function check(args: Record<string, unknown>): Promise<string> {
  return textOf(await client.callTool({ name: 'check-workspace', arguments: { directory, ...args } }))
}

async function withOnlyTheApp(): Promise<void> {
  for (const module of [path.join('src', 'modules'), path.join('src', 'billing')]) {
    await fs.rm(path.join(directory, module), { recursive: true, force: true })
  }
  for (const state of ['workflow-actions-state.json', 'workflow-triggers-state.json', 'billing-state.json']) {
    await fs.rm(path.join(directory, '.ghl', state), { force: true })
  }
}

beforeEach(async () => {
  config = await portalConfig()
  directory = await writeTestWorkspace(path.join(config.configDir, 'apps', 'acme'))
  client = await connectClient(createMcpServer({ version: '1.0.0', toolsets: [workspaceToolset(config)] }))
})

afterEach(async () => {
  await client.close()
  await fs.rm(config.configDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('check-workspace', () => {
  it('validates offline and lists every module with the next step', async () => {
    await editJson(appManifest(directory), app => {
      app.basicInfo.tagline = 'A sharper tagline for every customer'
    })
    expect(await check({ directory: path.join(directory, 'src'), remote: false })).toBe(
      [
        `Workspace ${directory} (appId app-1, versionId version-1), local files only.`,
        'Workflow actions (0): valid; no local changes.',
        'Workflow triggers (0): valid; no local changes.',
        'Billing plans and meters (0): valid; no local changes.',
        'App (ghl-app.json, webhooks): valid; local changes: basicInfo.tagline.',
        'Next: compare with the portal (check-workspace with remote: true, logged in) to get a push plan.'
      ].join('\n')
    )
  })

  it('makes no claim about local changes for files it cannot read', async () => {
    const actions = path.join(directory, 'src', 'modules', 'workflows', 'actions')
    await fs.mkdir(actions, { recursive: true })
    await fs.writeFile(path.join(actions, 'broken.json'), '{"key": 1}')

    const text = await check({ remote: false })
    expect(text).toMatch(/^Workflow actions: \d+ error\(s\)\.$/m)
    expect(text).toContain('Billing plans and meters (0): 1 error(s); no local changes.')
  })

  it('falls back to local validation, and says why, when nobody is logged in', async () => {
    expect((await check({})).split('\n')[0]).toBe(
      `Workspace ${directory} (appId app-1, versionId version-1), local files only (not logged in; call login to compare with the portal).`
    )
  })

  it('compares with the portal and lists errors with how to proceed', async () => {
    await withOnlyTheApp()
    await signIn(config)
    vi.stubGlobal(
      'fetch',
      routePortal({
        [`GET ${API}/app/app-1/versions/version-1`]: completeAppVersion({ website: 'https://new.example.com' })
      })
    )
    await editJson(appManifest(directory), app => {
      app.basicInfo.tagline = 'Short'
    })

    expect(await check({})).toBe(
      [
        `Workspace ${directory} (appId app-1, versionId version-1), compared with the developer portal.`,
        'App (ghl-app.json, webhooks): 1 error(s); local changes: basicInfo.tagline.',
        '- Tagline must be at least 20 characters.',
        'Next: fix every error above, then call check-workspace again.'
      ].join('\n')
    )

    await editJson(appManifest(directory), app => {
      app.basicInfo.tagline = 'Keep every customer conversation organized'
    })
    expect(await check({})).toContain(
      'App (ghl-app.json, webhooks): valid; no local changes; portal changes since the last pull: basicInfo.website.\nNext: the portal is ahead of these files; pull-app refreshes them.'
    )
  })

  it('lists the workspaces below a folder that is not one', async () => {
    const parent = path.dirname(directory)
    const result = await client.callTool({ name: 'check-workspace', arguments: { directory: parent } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `NO_WORKSPACE: No app workspace contains "${parent}". Workspaces below it: ${directory}. Pass one as directory.`
    )
  })
})

describe('scaffold-workflow-module', () => {
  const scaffold = (args: Record<string, unknown>) =>
    client.callTool({ name: 'scaffold-workflow-module', arguments: { directory, ...args } })

  it('adds several actions and triggers in one call and points at the files and rules', async () => {
    const result = await scaffold({
      typescript: true,
      modules: [
        { kind: 'action', name: 'Send SMS', key: 'send_sms' },
        { kind: 'trigger', name: 'Deal won', key: 'deal_won' }
      ]
    })
    expect(textOf(result)).toBe(
      [
        `Added to ${directory} (local drafts until pushed):`,
        '- action send_sms "Send SMS": src/modules/workflows/actions/send-sms.json, handler src/modules/workflows/actions/code/send_sms.1.0.ts',
        '- trigger deal_won "Deal won": src/modules/workflows/triggers/deal-won.json',
        'Required before pushing:',
        '- ghl-app.json.oauth.allowedScopes must include "workflows.readonly" before workflow actions can be pushed or published.',
        '- ghl-app.json.oauth.allowedScopes must include "workflows.readonly" before workflow triggers can be pushed or published.',
        'Next: fill in the generated files following src/modules/workflows/actions/HIGHLEVEL_WORKFLOW_ACTIONS.md and src/modules/workflows/triggers/HIGHLEVEL_WORKFLOW_TRIGGERS.md (also searchable with search-docs kind "cli"), then call check-workspace.'
      ].join('\n')
    )
    expect(await check({ remote: false })).toContain(
      'Workflow actions (1): 1 error(s); local changes: actions.send_sms.'
    )
  })

  it('reports a rejected module without undoing the others, and fails when none was added', async () => {
    const mixed = await scaffold({
      modules: [
        { kind: 'action', name: 'Send SMS', key: 'send_sms' },
        { kind: 'action', name: 'Again', key: 'send_sms' }
      ]
    })
    expect(mixed.isError).toBeFalsy()
    expect(textOf(mixed)).toContain(
      'Not added:\n- action send_sms: workflow-actions.json.actions[1].key duplicates action key "send_sms".'
    )

    const none = await scaffold({ modules: [{ kind: 'action', name: 'Again', key: 'send_sms' }] })
    expect(none.isError).toBe(true)
    expect(textOf(none)).toMatch(/^Not added:\n- action send_sms: /)
  })

  it('validates keys before touching the workspace', async () => {
    const invalid = await scaffold({ modules: [{ kind: 'action', name: 'Send', key: 'Send-SMS' }] })
    expect(invalid.isError).toBe(true)
    expect(await check({ remote: false })).toContain('Workflow actions (0): valid; no local changes.')
  })
})

describe('push-workspace', () => {
  const push = (args: Record<string, unknown>) =>
    client.callTool({ name: 'push-workspace', arguments: { directory, ...args } })
  const planIdOf = (text: string) => /planId ([0-9a-f]{12})/.exec(text)?.[1]
  const NEW_TAGLINE = 'A sharper tagline for every customer'

  async function portalWithTagline() {
    let tagline = completeAppVersion().tagline
    const fetch = routePortal({
      [`GET ${API}/app/app-1/versions/version-1`]: () => completeAppVersion({ tagline }),
      [`PUT ${API}/app/profile/app-1/versions/version-1/basicInfo`]: (init: RequestInit | undefined) => {
        tagline = JSON.parse(String(init?.body)).tagline
        return { oAuthClient: { _id: 'version-1', appId: 'app-1' } }
      }
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  beforeEach(async () => {
    await withOnlyTheApp()
    await signIn(config)
    await editJson(appManifest(directory), app => {
      app.basicInfo.tagline = NEW_TAGLINE
    })
  })

  it('pushes exactly the reviewed plan and leaves the workspace in sync', async () => {
    await portalWithTagline()
    const checked = await check({})
    expect(checked).toContain('local changes: basicInfo.tagline; no portal changes; push: basicInfo.')

    expect(textOf(await push({ planId: planIdOf(checked) }))).toBe(
      [
        `Pushed ${directory} to the developer portal:`,
        '- App (ghl-app.json, webhooks): basicInfo; the workspace is now bound to versionId version-1.',
        'Next: get-app shows publish readiness; release-app publishes when the user asks.'
      ].join('\n')
    )
    expect(await check({})).toContain('Everything matches the developer portal.')
    /* The selection follows the push in this server's own config directory. */
    await expect(getSelectedApp(config.configDir, 'default')).resolves.toMatchObject({ versionId: 'version-1' })
  })

  it('points pushed action and trigger drafts at their test and release tools', () => {
    const pushed = (name: 'actions' | 'triggers' | 'app', applied: string[]) => ({ name, applied, failed: [] })
    expect(nextAfterPush([pushed('actions', ['create:send_sms']), pushed('app', ['basicInfo'])])).toMatch(
      /test-workflow-action.*release-workflow-module/
    )
    expect(nextAfterPush([pushed('triggers', ['update:deal_won@1.0'])])).toBe(
      'Next: when the user asks, release-workflow-module publishes action and trigger drafts and release-app the app.'
    )
    expect(nextAfterPush([pushed('triggers', ['delete:deal_won']), pushed('app', ['basicInfo'])])).toBe(
      'Next: get-app shows publish readiness; release-app publishes when the user asks.'
    )
  })

  it('asks the user directly with the real values, and pushes only once they accept', async () => {
    const fetch = await portalWithTagline()
    const user: ConfirmingUser = { answer: 'decline', questions: [] }
    await client.close()
    client = await connectClient(createMcpServer({ version: '1.0.0', toolsets: [workspaceToolset(config)] }), user)
    const planId = planIdOf(await check({}))

    expect(textOf(await push({ planId }))).toBe('DECLINED: The user declined the push; nothing was pushed.')
    expect(user.questions[0]).toContain(`basicInfo.tagline: "${completeAppVersion().tagline}" -> "${NEW_TAGLINE}"`)

    /* Headless clients close the dialog without showing it. */
    user.answer = 'cancel'
    expect(textOf(await push({ planId }))).toMatch(
      /^CONFIRMATION_REQUIRED: The approval dialog was closed without an answer, so nothing was pushed\./
    )
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)

    user.answer = 'accept'
    expect(textOf(await push({ planId }))).toMatch(/^Pushed /)
  })

  it('pushes nothing when the files changed after the plan was made', async () => {
    const fetch = await portalWithTagline()
    const planId = planIdOf(await check({}))
    await editJson(appManifest(directory), app => {
      app.basicInfo.companyName = 'Edited after review'
    })

    const result = await push({ planId })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(
      /^PLAN_CHANGED: The workspace or the portal changed since that plan was made; nothing was pushed\./
    )
    expect(textOf(result)).toContain('get their approval before pushing again')
    expect(textOf(result)).not.toMatch(/planId [0-9a-f]{12}/)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })
})

describe('test-workflow-action', () => {
  const test = (args: Record<string, unknown>) =>
    client.callTool({ name: 'test-workflow-action', arguments: { directory, key: 'send_sms', ...args } })

  beforeEach(async () => {
    await signIn(config)
    await client.callTool({
      name: 'scaffold-workflow-module',
      arguments: { directory, modules: [{ kind: 'action', name: 'Send SMS', key: 'send_sms' }] }
    })
  })

  it('runs the local configuration through the test runner and returns its output and logs', async () => {
    const fetch = routePortal({
      [`GET ${OAUTH}/clients/app-1/actions`]: { actions: [] },
      [`POST ${WORKFLOWS}/run-code-test`]: { hasError: false, output: { sent: true }, consoleLogs: ['sending\nnow'] }
    })
    vi.stubGlobal('fetch', fetch)

    expect(textOf(await test({ input: { phone: '+15550100' } }))).toBe(
      ['Test passed: action send_sms version 1.0 (CODE).', 'Output: {"sent":true}', 'Console:', '  sending now'].join(
        '\n'
      )
    )
    const [, init] = fetch.mock.calls.find(([url]) => String(url).endsWith('/run-code-test')) ?? []
    expect(JSON.parse(String(init?.body))).toMatchObject({ appId: 'app-1', inputData: { phone: '+15550100' } })
  })

  it("sends header secrets to a new destination only with the user's direct approval, and redacts them", async () => {
    const actions = path.join(directory, 'src', 'modules', 'workflows', 'actions')
    await fs.rm(path.join(actions, 'code'), { recursive: true, force: true })
    await editJson(path.join(actions, 'send-sms.json'), action => {
      action.versions[0].executionConfig = {
        type: 'API',
        url: 'https://hooks.example.com/sms',
        method: 'POST',
        headers: { Authorization: '${env:SMS_API_KEY}' }
      }
    })
    vi.stubEnv('SMS_API_KEY', 'sk-live-123456')
    const fetch = routePortal({
      [`GET ${OAUTH}/clients/app-1/actions`]: { actions: [] },
      [`POST ${WORKFLOWS}/run-code-test`]: {
        hasError: false,
        output: { echoed: 'sk-live-123456' },
        consoleLogs: ['auth sk-live-123456']
      }
    })
    vi.stubGlobal('fetch', fetch)

    const refused = await test({})
    expect(textOf(refused)).toMatch(
      /^CONFIRMATION_REQUIRED: The test sends header secrets to new destinations \(action send_sms 1\.0 header executionConfig\.headers\.Authorization \(env SMS_API_KEY\) -> https:\/\/hooks\.example\.com\/sms\)/
    )
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/run-code-test'))).toBe(false)

    const user: ConfirmingUser = { answer: 'accept', questions: [] }
    await client.close()
    client = await connectClient(createMcpServer({ version: '1.0.0', toolsets: [workspaceToolset(config)] }), user)
    expect(textOf(await test({}))).toBe(
      [
        'Test passed: action send_sms version 1.0 (API).',
        'Output: {"echoed":"[redacted]"}',
        'Console:',
        '  auth [redacted]'
      ].join('\n')
    )
    expect(user.questions[0]).toContain('(env SMS_API_KEY) -> https://hooks.example.com/sms')
    vi.unstubAllEnvs()
  })

  it('reports a failing run with its reason', async () => {
    vi.stubGlobal(
      'fetch',
      routePortal({
        [`GET ${OAUTH}/clients/app-1/actions`]: { actions: [] },
        [`POST ${WORKFLOWS}/run-code-test`]: { hasError: true, errorMessage: 'ReferenceError: fetch is not defined' }
      })
    )
    expect(textOf(await test({}))).toBe(
      'TEST_FAILED: Workflow action test failed: ReferenceError: fetch is not defined'
    )
  })

  it('reports an unknown action key as not found, before calling the portal', async () => {
    vi.stubGlobal('fetch', routePortal({}))
    expect(textOf(await test({ key: 'missing_action' }))).toBe(
      'NOT_FOUND: Workflow action "missing_action" was not found in this workspace.'
    )
  })
})
