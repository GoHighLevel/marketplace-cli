import path from 'node:path'
import type { Readable, Writable } from 'node:stream'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import { CLI_VERSION } from '../api/version-header.js'
import type { CliConfig } from '../config/environment.js'
import { DocsService } from '../docs/service.js'
import { MCP_SERVER_NAME } from './clients.js'
import type { Toolset } from './tool.js'
import { accountToolset } from './tools/account.js'
import { appsToolset } from './tools/apps.js'
import { docsToolset } from './tools/docs.js'
import { releaseToolset } from './tools/release.js'
import { settingsToolset } from './tools/settings.js'
import { workspaceToolset } from './tools/workspace.js'

export interface McpServerOptions {
  version: string
  toolsets: readonly Toolset[]
}

const INSTRUCTIONS_PREAMBLE = `${MCP_SERVER_NAME} is the HighLevel Marketplace CLI (\`ghl\`) server for building HighLevel marketplace apps and integrations: OAuth apps, scopes, webhooks, workflow actions and triggers, billing, external authentication, and the HighLevel API.`

export function buildServerInstructions(toolsets: readonly Toolset[]): string {
  const lines = toolsets.flatMap(toolset => toolset.instructions.map(line => `- ${line}`))
  return [INSTRUCTIONS_PREAMBLE, ...lines].join('\n')
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: 'HighLevel Marketplace Developer', version: options.version },
    { instructions: buildServerInstructions(options.toolsets) }
  )
  for (const toolset of options.toolsets) {
    for (const register of toolset.tools) register(server)
  }
  return server
}

/* The server the CLI ships: every toolset wired to the user's CLI config. */
export function createMarketplaceMcpServer(config: CliConfig): McpServer {
  const docs = new DocsService({
    cacheDir: path.join(config.configDir, 'cache', 'docs'),
    userAgent: `ghl-marketplace-cli/${CLI_VERSION}`
  })
  return createMcpServer({
    version: CLI_VERSION,
    toolsets: [
      docsToolset(docs),
      accountToolset(config),
      appsToolset(config),
      workspaceToolset(config),
      releaseToolset(config),
      settingsToolset(config)
    ]
  })
}

/* stdout carries JSON-RPC frames, so anything a dependency logs is moved to
   stderr, where clients collect server diagnostics, until serving ends. */
function routeConsoleToStderr(): () => void {
  /* eslint-disable no-console */
  const original = { log: console.log, info: console.info, debug: console.debug }
  console.log = console.error
  console.info = console.error
  console.debug = console.error
  return () => Object.assign(console, original)
  /* eslint-enable no-console */
}

type JsonRpcId = string | number

interface DrainableTransport {
  transport: Transport
  /* Resolves once every request received so far has been answered. */
  drained: () => Promise<void>
}

/* Wraps the stdio transport before the server connects, so every request is
   counted from the first byte and can be answered after stdin ends. */
function drainable(inner: StdioServerTransport): DrainableTransport {
  const pending = new Set<JsonRpcId>()
  let settle: (() => void) | undefined
  const transport: Transport = {
    start: () => inner.start(),
    close: () => inner.close(),
    send: async message => {
      try {
        await inner.send(message)
      } finally {
        if (!('method' in message) && 'id' in message && message.id !== undefined) pending.delete(message.id)
        if (pending.size === 0) settle?.()
      }
    }
  }
  inner.onmessage = message => {
    if ('method' in message && 'id' in message) pending.add(message.id)
    transport.onmessage?.(message)
  }
  inner.onclose = () => transport.onclose?.()
  inner.onerror = error => transport.onerror?.(error)

  const drained = () =>
    pending.size === 0
      ? Promise.resolve()
      : new Promise<void>(resolve => {
          settle = resolve
        })
  return { transport, drained }
}

/* Serves until the client closes stdin, which is how every MCP client ends a
   stdio session (the SDK transport does not watch for it). Requests already
   received are answered before the server closes, so piped input works. */
export async function serveOverStdio(
  server: McpServer,
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout
): Promise<void> {
  const restoreConsole = routeConsoleToStderr()
  try {
    const closed = new Promise<void>(resolve => {
      server.server.onclose = resolve
    })
    const { transport, drained } = drainable(new StdioServerTransport(stdin, stdout))
    let finishing: Promise<void> | undefined
    const finish = () => {
      finishing ??= drained().then(() => server.close())
    }
    stdin.once('end', finish)
    stdin.once('close', finish)
    /* A client that exits mid-response breaks the pipe; stop instead of crashing on EPIPE. */
    stdout.once('error', () => void server.close())

    await server.connect(transport)
    await closed
  } finally {
    restoreConsole()
  }
}
