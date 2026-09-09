import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command, Config, ux } from '@oclif/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import AccountSwitch from '../../src/commands/account/switch.js'
import AppActionsPush from '../../src/commands/app/actions/push.js'
import AppActionsValidate from '../../src/commands/app/actions/validate.js'
import AppBillingValidate from '../../src/commands/app/billing/validate.js'
import AppCreate from '../../src/commands/app/create.js'
import AppDiff from '../../src/commands/app/diff.js'
import AppKeysCreate from '../../src/commands/app/keys/create.js'
import AppPublish from '../../src/commands/app/publish.js'
import AppPull from '../../src/commands/app/pull.js'
import AppPush from '../../src/commands/app/push.js'
import AppSecurityReview from '../../src/commands/app/security-review.js'
import AppSsoKey from '../../src/commands/app/sso-key.js'
import AppTriggersValidate from '../../src/commands/app/triggers/validate.js'
import AppValidate from '../../src/commands/app/validate.js'
import AppWebhookSubscribe from '../../src/commands/app/webhook/subscribe.js'
import AppWebhookUnsubscribe from '../../src/commands/app/webhook/unsubscribe.js'
import AppWebhookUrl from '../../src/commands/app/webhook/url.js'
import AppWithdraw from '../../src/commands/app/withdraw.js'
import SandboxDelete from '../../src/commands/sandbox/delete.js'
import SecretsReveal from '../../src/commands/secrets/reveal.js'

type CommandConstructor = new (argv: string[], config: Config) => Command

interface CommandResult {
  exitCode: number
  stderr: string
  stdout: string
}

const ROOT_DIRECTORY = fileURLToPath(new URL('../..', import.meta.url))
const COMMAND_DIRECTORY = path.join(ROOT_DIRECTORY, 'src/commands')
let configDir: string
let commandConfig: Config
let commandIds: Set<string>

async function listCommandIds(directory = COMMAND_DIRECTORY, segments: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const ids = await Promise.all(entries.map(async entry => {
    if (entry.isDirectory()) return listCommandIds(path.join(directory, entry.name), [...segments, entry.name])
    if (!entry.isFile() || !entry.name.endsWith('.ts')) return []

    const commandSegments = [...segments, entry.name.slice(0, -3)]
    if (commandSegments.at(-1) === 'index') commandSegments.pop()
    return [commandSegments.join(':')]
  }))
  return ids.flat()
}

async function runCommand(CommandType: CommandConstructor, args: string[]): Promise<CommandResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  const stdoutSpy = vi.spyOn(ux, 'stdout').mockImplementation((message = '', ...values) => {
    stdout.push([...(Array.isArray(message) ? message : [message]), ...values].join(' '))
  })
  const stderrSpy = vi.spyOn(ux, 'stderr').mockImplementation((message = '', ...values) => {
    stderr.push([...(Array.isArray(message) ? message : [message]), ...values].join(' '))
  })
  const previousExitCode = process.exitCode
  process.exitCode = undefined
  let exitCode = 0

  try {
    const command = new CommandType(args, commandConfig)
    await command._run()
  } catch (error) {
    stderr.push(error instanceof Error ? error.message : String(error))
  } finally {
    exitCode = process.exitCode ?? 0
    process.exitCode = previousExitCode
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  }

  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode }
}

beforeAll(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-contracts-'))
  vi.stubEnv('GHL_CONFIG_DIR', configDir)
  vi.stubEnv('NO_COLOR', '1')
  commandConfig = await Config.load({ root: ROOT_DIRECTORY })
  commandIds = new Set(await listCommandIds())
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await fs.rm(configDir, { recursive: true, force: true })
})

describe('public command contracts', () => {
  it('documents app-create choices and fails closed when automation omits them', async () => {
    expect(AppCreate.flags.type.options).toEqual(['public', 'private'])
    expect(AppCreate.flags.target.options).toEqual(['sub-account', 'agency'])
    expect(AppCreate.flags).toHaveProperty('directory')
    expect(AppCreate.flags).toHaveProperty('folder')

    const result = await runCommand(AppCreate, ['--name', 'Automated App', '--json'])
    expect(result.exitCode).not.toBe(0)
    const failure = JSON.parse(result.stdout) as { error: { message: string } }
    expect(failure.error.message).toMatch(/missing required flag.*--type.*--target.*--listing/i)
  })

  it('exposes app pull with explicit workspace and version controls', async () => {
    expect(AppPull.args).toHaveProperty('appId')
    expect(AppPull.flags).toEqual(expect.objectContaining({
      version: expect.any(Object),
      directory: expect.any(Object),
      folder: expect.any(Object)
    }))
    expect(commandIds).toContain('app:pull')
  })

  it('exposes the local validate, diff, and push workflow without authenticating invalid workspaces', async () => {
    const commands: Array<[string, CommandConstructor & { flags: Record<string, unknown> }]> = [
      ['app:validate', AppValidate],
      ['app:diff', AppDiff],
      ['app:push', AppPush]
    ]
    for (const [id, CommandType] of commands) {
      expect(CommandType.flags).toHaveProperty('directory')
      const invalid = await runCommand(CommandType, ['--directory', configDir])
      expect(invalid.exitCode).not.toBe(0)
      expect(invalid.stderr).toMatch(/ghl-app\.json|app workspace/i)
      expect(invalid.stderr).not.toMatch(/not logged in/i)
      expect(commandIds).toContain(id)
    }
  })

  it('requires a local workspace for webhook mutations before authenticating', async () => {
    const commands = [
      { CommandType: AppWebhookUrl, args: ['https://hooks.example.com'] },
      { CommandType: AppWebhookSubscribe, args: ['ContactCreate'] },
      { CommandType: AppWebhookUnsubscribe, args: ['ContactCreate'] }
    ]
    for (const { CommandType, args } of commands) {
      expect(CommandType.flags).toHaveProperty('directory')
      const invalid = await runCommand(CommandType, [...args, '--directory', configDir])
      expect(invalid.exitCode).not.toBe(0)
      expect(invalid.stderr).toMatch(/app workspace|ghl-app\.json/i)
      expect(invalid.stderr).not.toMatch(/not logged in/i)
    }

    const invalidUrl = await runCommand(AppWebhookUrl, [
      'http://127.0.0.1/internal-hook',
      '--directory',
      configDir
    ])
    expect(invalidUrl.exitCode).not.toBe(0)
    expect(invalidUrl.stderr).toMatch(/valid https:\/\/ URL/i)
    expect(invalidUrl.stderr).not.toMatch(/not logged in|app workspace|ghl-app\.json/i)
  })

  it('exposes the JSON-first workflow action lifecycle and validates local input before authentication', async () => {
    expect([...commandIds]).toEqual(expect.arrayContaining([
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
    ]))

    const invalid = await runCommand(AppActionsValidate, ['--directory', configDir])
    expect(invalid.exitCode).not.toBe(0)
    expect(invalid.stderr).toMatch(/workflow action|ghl-app\.json/i)
    expect(invalid.stderr).not.toMatch(/not logged in/i)

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
        customVars: [{ name: 'Status', reference: 'result', fieldType: 'string' }]
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

    const validation = await runCommand(AppActionsValidate, ['--directory', workspace, '--json'])
    expect(validation.exitCode).not.toBe(0)
    const validationFailure = JSON.parse(validation.stdout) as { error: { message: string } }
    expect(validationFailure.error.message).toMatch(/reference "result" must select a primitive value or a non-empty array/)
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

    const push = await runCommand(AppActionsPush, ['--directory', workspace, '--json'])
    expect(push.exitCode).not.toBe(0)
    const pushFailure = JSON.parse(push.stdout) as { error: { message: string } }
    expect(pushFailure.error.message).toMatch(/workflow action code is invalid[\s\S]*send_message\.1\.0\.js:1/i)
    expect(pushFailure.error.message).not.toMatch(/not logged in/i)
  })

  it('exposes the JSON-first workflow trigger lifecycle and validates local input before authentication', async () => {
    expect([...commandIds]).toEqual(expect.arrayContaining([
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

    const invalid = await runCommand(AppTriggersValidate, ['--directory', configDir])
    expect(invalid.exitCode).not.toBe(0)
    expect(invalid.stderr).toMatch(/workflow trigger|ghl-app\.json/i)
    expect(invalid.stderr).not.toMatch(/not logged in/i)
  })

  it('exposes JSON-first billing lifecycles and validates the workspace before authentication', async () => {
    expect([...commandIds]).toEqual(expect.arrayContaining([
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

    const invalid = await runCommand(AppBillingValidate, ['--directory', configDir])
    expect(invalid.exitCode).not.toBe(0)
    expect(invalid.stderr).toMatch(/billing|ghl-app\.json/i)
    expect(invalid.stderr).not.toMatch(/not logged in/i)
  })

  it('requires explicit non-interactive input before authentication or mutation', async () => {
    const key = await runCommand(AppKeysCreate, [])
    expect(key.stderr).toMatch(/pass the key name.*non-interactively/i)

    const publish = await runCommand(AppPublish, [])
    expect(publish.stderr).toMatch(/pass[\s\S]*--force[\s\S]*non-interactively/i)

    const sso = await runCommand(AppSsoKey, ['--force'])
    expect(sso.stderr).toMatch(/non-interactive SSO key rotation requires --reveal/i)

    const withdraw = await runCommand(AppWithdraw, [])
    expect(withdraw.stderr).toMatch(/withdrawing[\s\S]*pass --force[\s\S]*non-interactively/i)
    expect(withdraw.stderr).not.toMatch(/not logged in/i)

    const securityReview = await runCommand(AppSecurityReview, [])
    expect(securityReview.stderr).toMatch(/security review[\s\S]*pass --force[\s\S]*non-interactively/i)
    expect(securityReview.stderr).not.toMatch(/not logged in/i)

    const deletion = await runCommand(SandboxDelete, ['company-id'])
    expect(deletion.stderr).toMatch(/pass[\s\S]*--force[\s\S]*non-interactively/i)
  })

  it('exposes account discovery and requires an explicit non-interactive account switch', async () => {
    expect([...commandIds]).toEqual(expect.arrayContaining(['account', 'account:switch']))

    const switchResult = await runCommand(AccountSwitch, [])
    expect(switchResult.exitCode).not.toBe(0)
    expect(switchResult.stderr).toMatch(/account id.*non-interactively/i)
    expect(switchResult.stderr).not.toMatch(/not logged in/i)

    const invalid = await runCommand(AccountSwitch, ['bad account'])
    expect(invalid.exitCode).not.toBe(0)
    expect(invalid.stderr).toMatch(/account id must contain/i)
    expect(invalid.stderr).not.toMatch(/not logged in/i)
  })

  it('keeps secret reveal gated and exposes discoverable public commands', async () => {
    const reveal = await runCommand(SecretsReveal, [])
    expect(reveal.exitCode).not.toBe(0)
    expect(reveal.stderr).toMatch(/interactive terminal.*--force/i)

    expect(commandIds).toContain('app:create')
    expect(commandIds).toContain('sandbox:delete')
  })
})
