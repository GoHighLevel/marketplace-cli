import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, ux } from '@oclif/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import McpSetup from '../../../src/commands/mcp/setup.js'

const ROOT_DIRECTORY = fileURLToPath(new URL('../../..', import.meta.url))
let home: string

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-mcp-setup-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('PATH', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  process.exitCode = undefined
  await fs.rm(home, { recursive: true, force: true })
})

async function runSetup(args: string[]): Promise<{ output: Record<string, any>; exitCode: number }> {
  const stdout: string[] = []
  const spy = vi.spyOn(ux, 'stdout').mockImplementation((message = '') => {
    stdout.push(String(message))
  })
  try {
    await new McpSetup(args, await Config.load({ root: ROOT_DIRECTORY }))._run()
  } finally {
    spy.mockRestore()
  }
  return { output: JSON.parse(stdout.join('\n')) as Record<string, any>, exitCode: process.exitCode ?? 0 }
}

describe('ghl mcp setup', () => {
  it('configures detected clients by absolute launch path and fails the run when any client fails', async () => {
    await fs.mkdir(path.join(home, '.cursor'))

    const { output, exitCode } = await runSetup(['--client', 'cursor', '--client', 'windsurf', '--json'])

    expect(output).toMatchObject({
      server: 'HighLevelMarketplaceDev',
      standalone: false,
      launch: { command: process.execPath, args: [path.join(ROOT_DIRECTORY, 'bin', 'run.js'), 'mcp', 'start'] },
      results: [
        { client: 'cursor', status: 'configured', target: path.join('~', '.cursor', 'mcp.json') },
        { client: 'windsurf', status: 'failed', message: expect.stringContaining('Windsurf was not detected') }
      ]
    })
    expect(exitCode).toBe(1)
    expect(JSON.parse(await fs.readFile(path.join(home, '.cursor', 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { HighLevelMarketplaceDev: output.launch }
    })
  })

  it('registers a pinned npx launch in standalone mode', async () => {
    await fs.mkdir(path.join(home, '.cursor'))

    const { output, exitCode } = await runSetup([
      '--client',
      'cursor',
      '--standalone',
      '--cli-version',
      '2.0.0',
      '--registry',
      'https://npm.example.com/',
      '--json'
    ])

    expect(exitCode).toBe(0)
    expect(output.launch.args).toEqual(
      expect.arrayContaining(['--registry=https://npm.example.com/', '@gohighlevel/marketplace-cli@2.0.0', 'ghl'])
    )
  })
})
