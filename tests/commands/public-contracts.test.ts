import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const cli = path.resolve('bin/run.js')
let configDir: string

async function runCli(args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, [cli, ...args], {
      env: { ...process.env, GHL_CONFIG_DIR: configDir, NO_COLOR: '1' },
      timeout: 10_000
    })
    return { ...result, exitCode: 0 }
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string }
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', exitCode: failure.code ?? 1 }
  }
}

function expectNoRuntimeWarning(result: { stderr: string }): void {
  expect(result.stderr).not.toMatch(/ExperimentalWarning|Importing JSON modules/i)
}

beforeAll(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-contracts-'))
})

afterAll(async () => {
  await fs.rm(configDir, { recursive: true, force: true })
})

describe('public command contracts', () => {
  it('documents app-create choices and fails closed when automation omits them', async () => {
    const help = await runCli(['app', 'create', '--help'])
    expectNoRuntimeWarning(help)
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toMatch(/--type.*public.*private/s)
    expect(help.stdout).toMatch(/--target.*sub-account.*agency/s)
    expect(help.stdout).toMatch(/--directory/)
    expect(help.stdout).toMatch(/--folder/)

    const result = await runCli(['app', 'create', '--name', 'Automated App', '--json'])
    expectNoRuntimeWarning(result)
    expect(result.exitCode).not.toBe(0)
    const failure = JSON.parse(result.stdout) as { error: { message: string } }
    expect(failure.error.message).toMatch(/missing required flag.*--type.*--target.*--listing/i)
  })

  it('exposes app pull with explicit workspace and version controls', async () => {
    const help = await runCli(['app', 'pull', '--help'])
    expectNoRuntimeWarning(help)
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toMatch(/appId/i)
    expect(help.stdout).toMatch(/--version/)
    expect(help.stdout).toMatch(/--directory/)
    expect(help.stdout).toMatch(/--folder/)

    const commands = await runCli(['commands', '--json'])
    const parsed = JSON.parse(commands.stdout) as Array<{ id: string }>
    expect(parsed.some(command => command.id === 'app:pull')).toBe(true)
  })

  it('exposes the local validate, diff, and push workflow without authenticating invalid workspaces', async () => {
    for (const command of ['validate', 'diff', 'push']) {
      const help = await runCli(['app', command, '--help'])
      expectNoRuntimeWarning(help)
      expect(help.exitCode).toBe(0)
      expect(help.stdout).toMatch(/--directory/)
    }

    for (const command of ['validate', 'diff', 'push']) {
      const invalid = await runCli(['app', command, '--directory', configDir])
      expectNoRuntimeWarning(invalid)
      expect(invalid.exitCode).not.toBe(0)
      expect(invalid.stderr).toMatch(/ghl-app\.json|app workspace/i)
      expect(invalid.stderr).not.toMatch(/not logged in/i)
    }

    const commands = await runCli(['commands', '--json'])
    const parsed = JSON.parse(commands.stdout) as Array<{ id: string }>
    expect(parsed.map(command => command.id)).toEqual(
      expect.arrayContaining(['app:validate', 'app:diff', 'app:push'])
    )
  })

  it('requires a local workspace for webhook mutations before authenticating', async () => {
    const commands = [
      ['url', 'https://hooks.example.com'],
      ['subscribe', 'ContactCreate'],
      ['unsubscribe', 'ContactCreate']
    ]
    for (const command of commands) {
      const help = await runCli(['app', 'webhook', command[0], '--help'])
      expectNoRuntimeWarning(help)
      expect(help.exitCode).toBe(0)
      expect(help.stdout).toMatch(/--directory/)

      const invalid = await runCli(['app', 'webhook', ...command, '--directory', configDir])
      expectNoRuntimeWarning(invalid)
      expect(invalid.exitCode).not.toBe(0)
      expect(invalid.stderr).toMatch(/app workspace|ghl-app\.json/i)
      expect(invalid.stderr).not.toMatch(/not logged in/i)
    }

    const invalidUrl = await runCli([
      'app',
      'webhook',
      'url',
      'http://127.0.0.1/internal-hook',
      '--directory',
      configDir
    ])
    expectNoRuntimeWarning(invalidUrl)
    expect(invalidUrl.exitCode).not.toBe(0)
    expect(invalidUrl.stderr).toMatch(/valid https:\/\/ URL/i)
    expect(invalidUrl.stderr).not.toMatch(/not logged in|app workspace|ghl-app\.json/i)
  })

  it('exposes the JSON-first workflow action lifecycle and validates local input before authentication', async () => {
    for (const command of ['pull', 'create', 'validate', 'test', 'diff', 'push', 'delete', 'new-version', 'publish']) {
      const help = await runCli(['app', 'actions', command, '--help'])
      expectNoRuntimeWarning(help)
      expect(help.exitCode).toBe(0)
    }

    const invalid = await runCli(['app', 'actions', 'validate', '--directory', configDir])
    expectNoRuntimeWarning(invalid)
    expect(invalid.exitCode).not.toBe(0)
    expect(invalid.stderr).toMatch(/workflow action|ghl-app\.json/i)
    expect(invalid.stderr).not.toMatch(/not logged in/i)

    const commands = await runCli(['commands', '--json'])
    const parsed = JSON.parse(commands.stdout) as Array<{ id: string }>
    expect(parsed.map(command => command.id)).toEqual(
      expect.arrayContaining([
        'app:actions',
        'app:actions:pull',
        'app:actions:create',
        'app:actions:validate',
        'app:actions:test',
        'app:actions:diff',
        'app:actions:push',
        'app:actions:delete',
        'app:actions:new-version',
        'app:actions:publish'
      ])
    )

    const workspace = path.join(configDir, 'invalid-workflow-action')
    const workflowDirectory = path.join(workspace, 'src', 'modules', 'workflows', 'actions')
    const stateDirectory = path.join(workspace, '.ghl')
    await Promise.all([
      fs.mkdir(workflowDirectory, { recursive: true }),
      fs.mkdir(stateDirectory, { recursive: true })
    ])
    const action: any = {
      schemaVersion: 1,
      key: 'send_message',
      versions: [{
        version: '1.0',
        status: 'draft',
        info: { name: 'Send message' },
        customVarsJson: { result: { status: 'delivered' } },
        customVars: [{ name: 'Status', reference: 'result.missing', fieldType: 'string' }]
      }]
    }
    const baseline = { schemaVersion: 1, appId: 'app-1', actions: [] }
    await Promise.all([
      fs.writeFile(path.join(workspace, 'ghl-app.json'), JSON.stringify({ appId: 'app-1', versionId: 'version-1' })),
      fs.writeFile(path.join(workflowDirectory, 'send-message.json'), JSON.stringify(action)),
      fs.writeFile(
        path.join(stateDirectory, 'workflow-actions-state.json'),
        JSON.stringify({ schemaVersion: 1, appId: 'app-1', baseline })
      )
    ])

    const validation = await runCli(['app', 'actions', 'validate', '--directory', workspace, '--json'])
    expectNoRuntimeWarning(validation)
    expect(validation.exitCode).not.toBe(0)
    const validationFailure = JSON.parse(validation.stdout) as { error: { message: string } }
    expect(validationFailure.error.message).toMatch(/result\.missing.*does not resolve in customVarsJson/)
    expect(validationFailure.error.message).not.toMatch(/not logged in/i)

    action.versions[0].customVars = []
    action.versions[0].executionConfig = {
      type: 'CODE',
      codeFile: 'code/send_message.1.0.js'
    }
    const codeDirectory = path.join(workflowDirectory, 'code')
    await fs.mkdir(codeDirectory)
    await Promise.all([
      fs.writeFile(path.join(workflowDirectory, 'send-message.json'), JSON.stringify(action)),
      fs.writeFile(path.join(codeDirectory, 'send_message.1.0.js'), 'const result = ;')
    ])

    const push = await runCli(['app', 'actions', 'push', '--directory', workspace, '--json'])
    expectNoRuntimeWarning(push)
    expect(push.exitCode).not.toBe(0)
    const pushFailure = JSON.parse(push.stdout) as { error: { message: string } }
    expect(pushFailure.error.message).toMatch(/workflow action code is invalid[\s\S]*send_message\.1\.0\.js:1/i)
    expect(pushFailure.error.message).not.toMatch(/not logged in/i)
  })

  it('exposes the JSON-first workflow trigger lifecycle and validates local input before authentication', async () => {
    for (const command of ['pull', 'create', 'validate', 'diff', 'push', 'delete', 'new-version', 'publish']) {
      const help = await runCli(['app', 'triggers', command, '--help'])
      expectNoRuntimeWarning(help)
      expect(help.exitCode).toBe(0)
    }

    const invalid = await runCli(['app', 'triggers', 'validate', '--directory', configDir])
    expectNoRuntimeWarning(invalid)
    expect(invalid.exitCode).not.toBe(0)
    expect(invalid.stderr).toMatch(/workflow trigger|ghl-app\.json/i)
    expect(invalid.stderr).not.toMatch(/not logged in/i)

    const commands = await runCli(['commands', '--json'])
    const parsed = JSON.parse(commands.stdout) as Array<{ id: string }>
    expect(parsed.map(command => command.id)).toEqual(expect.arrayContaining([
      'app:triggers',
      'app:triggers:pull',
      'app:triggers:create',
      'app:triggers:validate',
      'app:triggers:diff',
      'app:triggers:push',
      'app:triggers:delete',
      'app:triggers:new-version',
      'app:triggers:publish'
    ]))
  })

  it('exposes JSON-first billing lifecycles and validates the workspace before authentication', async () => {
    for (const command of ['pull', 'validate', 'diff', 'push']) {
      const help = await runCli(['app', 'billing', command, '--help'])
      expectNoRuntimeWarning(help)
      expect(help.exitCode).toBe(0)
    }
    for (const resource of ['plan', 'meter']) {
      for (const command of ['create', 'delete']) {
        const help = await runCli(['app', 'billing', resource, command, '--help'])
        expectNoRuntimeWarning(help)
        expect(help.exitCode).toBe(0)
      }
    }

    const invalid = await runCli(['app', 'billing', 'validate', '--directory', configDir])
    expectNoRuntimeWarning(invalid)
    expect(invalid.exitCode).not.toBe(0)
    expect(invalid.stderr).toMatch(/billing|ghl-app\.json/i)
    expect(invalid.stderr).not.toMatch(/not logged in/i)

    const commands = await runCli(['commands', '--json'])
    const parsed = JSON.parse(commands.stdout) as Array<{ id: string }>
    expect(parsed.map(command => command.id)).toEqual(expect.arrayContaining([
      'app:billing',
      'app:billing:pull',
      'app:billing:validate',
      'app:billing:diff',
      'app:billing:push',
      'app:billing:plan',
      'app:billing:plan:create',
      'app:billing:plan:delete',
      'app:billing:meter',
      'app:billing:meter:create',
      'app:billing:meter:delete'
    ]))
  })

  it('requires explicit non-interactive input before authentication or mutation', async () => {
    const key = await runCli(['app', 'keys', 'create'])
    expectNoRuntimeWarning(key)
    expect(key.stderr).toMatch(/pass the key name.*non-interactively/i)

    const publish = await runCli(['app', 'publish'])
    expectNoRuntimeWarning(publish)
    expect(publish.stderr).toMatch(/pass[\s\S]*--force[\s\S]*non-interactively/i)

    const sso = await runCli(['app', 'sso-key', '--force'])
    expectNoRuntimeWarning(sso)
    expect(sso.stderr).toMatch(/non-interactive SSO key rotation requires --reveal/i)

    const withdraw = await runCli(['app', 'withdraw'])
    expectNoRuntimeWarning(withdraw)
    expect(withdraw.stderr).toMatch(/withdrawing[\s\S]*pass --force[\s\S]*non-interactively/i)
    expect(withdraw.stderr).not.toMatch(/not logged in/i)

    const securityReview = await runCli(['app', 'security-review'])
    expectNoRuntimeWarning(securityReview)
    expect(securityReview.stderr).toMatch(/security review[\s\S]*pass --force[\s\S]*non-interactively/i)
    expect(securityReview.stderr).not.toMatch(/not logged in/i)

    const deletion = await runCli(['sandbox', 'delete', 'company-id'])
    expectNoRuntimeWarning(deletion)
    expect(deletion.stderr).toMatch(/pass[\s\S]*--force[\s\S]*non-interactively/i)
  })

  it('exposes account discovery and requires an explicit non-interactive account switch', async () => {
    for (const command of [['account'], ['account', 'switch']]) {
      const help = await runCli([...command, '--help'])
      expectNoRuntimeWarning(help)
      expect(help.exitCode).toBe(0)
    }

    const switchResult = await runCli(['account', 'switch'])
    expectNoRuntimeWarning(switchResult)
    expect(switchResult.exitCode).not.toBe(0)
    expect(switchResult.stderr).toMatch(/account id.*non-interactively/i)
    expect(switchResult.stderr).not.toMatch(/not logged in/i)

    const invalid = await runCli(['account', 'switch', 'bad account'])
    expectNoRuntimeWarning(invalid)
    expect(invalid.exitCode).not.toBe(0)
    expect(invalid.stderr).toMatch(/account id must contain/i)
    expect(invalid.stderr).not.toMatch(/not logged in/i)

    const commands = await runCli(['commands', '--json'])
    const parsed = JSON.parse(commands.stdout) as Array<{ id: string }>
    expect(parsed.map(command => command.id)).toEqual(expect.arrayContaining(['account', 'account:switch']))
  })

  it('keeps secret reveal gated and exposes machine-readable command discovery', async () => {
    const reveal = await runCli(['secrets', 'reveal'])
    expectNoRuntimeWarning(reveal)
    expect(reveal.exitCode).not.toBe(0)
    expect(reveal.stderr).toMatch(/interactive terminal.*--force/i)

    const commands = await runCli(['commands', '--json'])
    expectNoRuntimeWarning(commands)
    expect(commands.exitCode).toBe(0)
    const parsed = JSON.parse(commands.stdout) as Array<{ id: string }>
    expect(parsed.some(command => command.id === 'app:create')).toBe(true)
    expect(parsed.some(command => command.id === 'sandbox:delete')).toBe(true)
  })
})
