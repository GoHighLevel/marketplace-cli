import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mcpClient, MCP_CLIENTS } from '../../../src/lib/mcp/clients.js'
import {
  detectInstalledClients,
  registerMcpClient,
  type RegistrationDependencies,
  upsertServerEntry
} from '../../../src/lib/mcp/registration.js'
import type { ExecutableResult } from '../../../src/lib/shared/executable.js'

const LAUNCH = { command: '/usr/bin/node', args: ['/opt/ghl/bin/run.js', 'mcp', 'start'] }
const NAME = 'HighLevelMarketplaceDev'
let home: string

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-mcp-home-'))
})

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

function ok(overrides: Partial<ExecutableResult> = {}): ExecutableResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...overrides }
}

function dependencies(overrides: Partial<RegistrationDependencies> = {}): RegistrationDependencies {
  return {
    home,
    env: {},
    platform: 'linux',
    findExecutable: async () => undefined,
    runExecutable: async () => ok(),
    ...overrides
  }
}

describe('upsertServerEntry', () => {
  it('creates a private config file with only the server entry', async () => {
    const file = path.join(home, '.cursor', 'mcp.json')
    await upsertServerEntry(file, 'mcpServers', NAME, LAUNCH)

    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ mcpServers: { [NAME]: LAUNCH } })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
  })

  it('keeps other servers, comments, settings, and permissions, and is idempotent', async () => {
    const file = path.join(home, 'mcp.json')
    const original = '{\n\t// my servers\n\t"servers": {\n\t\t"other": { "url": "x" }\n\t},\n\t"inputs": []\n}\n'
    await fs.writeFile(file, original, { mode: 0o640 })

    await upsertServerEntry(file, 'servers', NAME, { type: 'stdio', ...LAUNCH })
    const first = await fs.readFile(file, 'utf8')
    await upsertServerEntry(file, 'servers', NAME, { type: 'stdio', ...LAUNCH })

    expect(first).toContain('// my servers')
    expect(first).toContain('"inputs": []')
    expect(first).toContain('"url": "x"')
    expect(first).toContain(`\t\t"${NAME}": {\n\t\t\t"type": "stdio"`)
    expect(await fs.readFile(file, 'utf8')).toBe(first)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o640)
  })

  it('replaces an outdated entry for the same server', async () => {
    const file = path.join(home, 'mcp.json')
    await fs.writeFile(file, JSON.stringify({ mcpServers: { [NAME]: { command: 'old' } } }))
    await upsertServerEntry(file, 'mcpServers', NAME, LAUNCH)
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ mcpServers: { [NAME]: LAUNCH } })
  })

  it('writes through a symlinked config so the link survives', async () => {
    const dotfiles = path.join(home, 'dotfiles', 'mcp.json')
    const link = path.join(home, 'mcp.json')
    await fs.mkdir(path.dirname(dotfiles))
    await fs.writeFile(dotfiles, '{}')
    await fs.symlink(dotfiles, link)

    await upsertServerEntry(link, 'mcpServers', NAME, LAUNCH)

    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await fs.readFile(dotfiles, 'utf8'))).toEqual({ mcpServers: { [NAME]: LAUNCH } })
  })

  it('creates the target of a dangling symlink instead of replacing the link', async () => {
    const target = path.join(home, 'dotfiles', 'mcp.json')
    const link = path.join(home, 'mcp.json')
    await fs.mkdir(path.dirname(target))
    await fs.symlink(target, link)

    await upsertServerEntry(link, 'mcpServers', NAME, LAUNCH)

    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ mcpServers: { [NAME]: LAUNCH } })
  })

  it('respects a read-only config', async () => {
    const file = path.join(home, 'mcp.json')
    await fs.writeFile(file, '{}', { mode: 0o444 })
    await expect(upsertServerEntry(file, 'mcpServers', NAME, LAUNCH)).rejects.toThrow(/mcp\.json is read-only/)
    expect(await fs.readFile(file, 'utf8')).toBe('{}')
  })

  it('never rewrites an invalid config or one whose server map is not an object', async () => {
    const invalid = path.join(home, 'invalid.json')
    await fs.writeFile(invalid, '{ "mcpServers": ')
    await expect(upsertServerEntry(invalid, 'mcpServers', NAME, LAUNCH)).rejects.toThrow(/invalid\.json is invalid/)
    expect(await fs.readFile(invalid, 'utf8')).toBe('{ "mcpServers": ')

    const wrongShape = path.join(home, 'array.json')
    await fs.writeFile(wrongShape, '{ "mcpServers": [] }')
    await expect(upsertServerEntry(wrongShape, 'mcpServers', NAME, LAUNCH)).rejects.toThrow(/not an object/)
  })
})

describe('detectInstalledClients', () => {
  it('detects file clients by config directory or executable and CLI clients by executable', async () => {
    await fs.mkdir(path.join(home, '.cursor'))
    const findExecutable = vi.fn(async (name: string) =>
      ['codex', 'gemini'].includes(name) ? `/bin/${name}` : undefined
    )

    await expect(detectInstalledClients(MCP_CLIENTS, dependencies({ findExecutable }))).resolves.toEqual([
      'codex',
      'cursor',
      'gemini'
    ])
  })
})

describe('registerMcpClient', () => {
  it('registers through the client CLI with a single add when the client accepts it', async () => {
    const runExecutable = vi.fn(async () => ok())
    const result = await registerMcpClient(
      mcpClient('codex'),
      NAME,
      LAUNCH,
      dependencies({ findExecutable: async () => '/bin/codex', runExecutable })
    )

    expect(result).toEqual({ client: 'codex', label: 'Codex CLI', status: 'configured', target: 'codex mcp add' })
    expect(runExecutable.mock.calls).toEqual([
      ['/bin/codex', ['mcp', 'add', NAME, '--', LAUNCH.command, ...LAUNCH.args]]
    ])
  })

  it('replaces an existing entry only after the client reports that it already exists', async () => {
    const runExecutable = vi
      .fn<RegistrationDependencies['runExecutable']>()
      .mockResolvedValueOnce(ok({ exitCode: 1, stderr: `MCP server ${NAME} already exists in user config` }))
      .mockResolvedValue(ok())
    const result = await registerMcpClient(
      mcpClient('claude'),
      NAME,
      LAUNCH,
      dependencies({ findExecutable: async () => '/bin/claude', runExecutable })
    )

    expect(result.status).toBe('configured')
    expect(runExecutable.mock.calls.map(([, args]) => args.slice(0, 2))).toEqual([
      ['mcp', 'add'],
      ['mcp', 'remove'],
      ['mcp', 'add']
    ])
  })

  it('never removes a working entry when the add fails for another reason', async () => {
    const runExecutable = vi.fn(async () => ok({ exitCode: 1, stderr: 'unknown option --scope' }))
    const result = await registerMcpClient(
      mcpClient('claude'),
      NAME,
      LAUNCH,
      dependencies({ findExecutable: async () => '/bin/claude', runExecutable })
    )

    expect(result).toMatchObject({ status: 'failed', message: 'claude exited with code 1: unknown option --scope' })
    expect(runExecutable).toHaveBeenCalledTimes(1)
  })

  it('reports a missing client CLI or a failed command with sanitized output', async () => {
    await expect(registerMcpClient(mcpClient('codex'), NAME, LAUNCH, dependencies())).resolves.toMatchObject({
      status: 'failed',
      message: 'codex was not found on PATH.'
    })

    const failing = dependencies({
      findExecutable: async () => '/bin/codex',
      runExecutable: async (_file, args) =>
        args[1] === 'add' ? ok({ exitCode: 2, stderr: '\u001b[31mbad\nconfig\u001b[0m' }) : ok()
    })
    await expect(registerMcpClient(mcpClient('codex'), NAME, LAUNCH, failing)).resolves.toMatchObject({
      status: 'failed',
      message: 'codex exited with code 2: bad config'
    })

    const slow = dependencies({
      findExecutable: async () => '/bin/codex',
      runExecutable: async () => ok({ exitCode: null, timedOut: true })
    })
    await expect(registerMcpClient(mcpClient('codex'), NAME, LAUNCH, slow)).resolves.toMatchObject({
      message: 'codex timed out.'
    })
  })

  it('writes file-based clients and reports the config path relative to home', async () => {
    await fs.mkdir(path.join(home, '.codeium', 'windsurf'), { recursive: true })
    await expect(registerMcpClient(mcpClient('windsurf'), NAME, LAUNCH, dependencies())).resolves.toEqual({
      client: 'windsurf',
      label: 'Windsurf',
      status: 'configured',
      target: path.join('~', '.codeium', 'windsurf', 'mcp_config.json')
    })
  })

  it('creates the Gemini config directory when only the executable exists', async () => {
    const result = await registerMcpClient(
      mcpClient('gemini'),
      NAME,
      LAUNCH,
      dependencies({ findExecutable: async name => (name === 'gemini' ? '/bin/gemini' : undefined) })
    )
    expect(result.status).toBe('configured')
    expect(JSON.parse(await fs.readFile(path.join(home, '.gemini', 'settings.json'), 'utf8'))).toEqual({
      mcpServers: { [NAME]: LAUNCH }
    })
  })

  it('does not create config for a client that is not installed', async () => {
    await expect(registerMcpClient(mcpClient('cursor'), NAME, LAUNCH, dependencies())).resolves.toMatchObject({
      status: 'failed',
      message: `Cursor was not detected (${path.join('~', '.cursor')} does not exist).`
    })
    await expect(fs.access(path.join(home, '.cursor'))).rejects.toThrow()
  })

  it('reports a broken config file as a failure for that client only', async () => {
    await fs.mkdir(path.join(home, '.cursor'))
    await fs.writeFile(path.join(home, '.cursor', 'mcp.json'), '[')
    await expect(registerMcpClient(mcpClient('cursor'), NAME, LAUNCH, dependencies())).resolves.toMatchObject({
      status: 'failed',
      target: path.join('~', '.cursor', 'mcp.json'),
      message: expect.stringMatching(/mcp\.json is invalid/)
    })
  })
})
