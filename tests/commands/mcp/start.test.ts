import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT_DIRECTORY = fileURLToPath(new URL('../../..', import.meta.url))
let configDir: string

beforeEach(async () => {
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-mcp-start-'))
})

afterEach(async () => {
  await fs.rm(configDir, { recursive: true, force: true })
})

function frame(message: Record<string, unknown>): string {
  return `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`
}

/* Drives the built binary exactly as an MCP client does: requests on stdin,
   then closing stdin to end the session. */
async function runSession(requests: string[], expectedResponses: number) {
  const child = spawn(process.execPath, [path.join(ROOT_DIRECTORY, 'bin', 'run.js'), 'mcp', 'start'], {
    env: { ...process.env, GHL_CONFIG_DIR: configDir, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  const exited = new Promise<number | null>(resolve => child.once('close', resolve))
  const responded = new Promise<void>(resolve => {
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += String(chunk)
      if (stdout.split('\n').filter(Boolean).length >= expectedResponses) resolve()
    })
  })

  for (const request of requests) child.stdin.write(request)
  await responded
  child.stdin.end()
  return { exitCode: await exited, lines: stdout.split('\n').filter(Boolean) }
}

describe('ghl mcp start', () => {
  it('speaks only JSON-RPC on stdout, lists its tools, and exits when the client disconnects', async () => {
    const { exitCode, lines } = await runSession(
      [
        frame({
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
        }),
        frame({ method: 'notifications/initialized' }),
        frame({ id: 2, method: 'tools/list' })
      ],
      2
    )

    const messages = lines.map(line => JSON.parse(line) as { jsonrpc: string; id: number; result: Record<string, any> })
    expect(messages.every(message => message.jsonrpc === '2.0')).toBe(true)
    expect(messages[0].result.serverInfo.name).toBe('HighLevelMarketplaceDev')
    expect(messages[0].result.instructions).toContain('search-docs')
    expect(messages[1].result.tools.map((tool: { name: string }) => tool.name)).toContain('search-docs')
    expect(exitCode).toBe(0)
  })
})
