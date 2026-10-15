import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { z } from 'zod'

import { MCP_SERVER_NAME } from '../../../src/lib/mcp/clients.js'
import {
  buildServerInstructions,
  createMarketplaceMcpServer,
  createMcpServer,
  serveOverStdio
} from '../../../src/lib/mcp/server.js'
import { defineTool, textResult, type Toolset } from '../../../src/lib/mcp/tool.js'
import { connectClient } from '../../helpers/mcp-client.js'

const MARKETPLACE_CONFIG = {
  portalUrl: 'https://portal.test',
  apiUrl: 'https://api.test',
  oauthUrl: 'https://oauth.test',
  workflowsUrl: 'https://workflows.test',
  configDir: '/nonexistent-config-dir'
}
const toolset: Toolset = { name: 'sample', instructions: ['Call sample first.', 'Then call sample again.'], tools: [] }

describe('MCP server', () => {
  it('composes instructions from every toolset', () => {
    const instructions = buildServerInstructions([toolset])
    expect(instructions.split('\n')).toEqual([
      expect.stringContaining('HighLevelMarketplaceDev'),
      '- Call sample first.',
      '- Then call sample again.'
    ])
  })

  it('identifies itself and sends its instructions during initialization', async () => {
    const client = await connectClient(createMcpServer({ version: '9.9.9', toolsets: [toolset] }))
    expect(client.getServerVersion()).toMatchObject({ name: MCP_SERVER_NAME, version: '9.9.9' })
    expect(client.getInstructions()).toContain('- Call sample first.')
  })

  it('ships every toolset, each tool marked read-only or not', async () => {
    const client = await connectClient(createMarketplaceMcpServer(MARKETPLACE_CONFIG))
    const { tools } = await client.listTools()
    expect(tools.map(tool => [tool.name, tool.annotations?.readOnlyHint])).toEqual([
      ['search-docs', true],
      ['fetch-doc', true],
      ['get-account', true],
      ['switch-account', false],
      ['manage-sandbox', false],
      ['login', false],
      ['get-app', true],
      ['create-app', false],
      ['pull-app', false],
      ['list-scopes', true],
      ['check-workspace', true],
      ['test-workflow-action', false],
      ['push-workspace', false],
      ['scaffold-workflow-module', false],
      ['release-app', false],
      ['release-workflow-module', false],
      ['update-media', false],
      ['manage-client-keys', false]
    ])
  })

  it('keeps every shipped tool within the token budgets in src/lib/mcp/GUIDELINES.md', async () => {
    const client = await connectClient(createMarketplaceMcpServer(MARKETPLACE_CONFIG))
    const { tools } = await client.listTools()

    expect(client.getInstructions()?.length).toBeLessThanOrEqual(1_500)
    for (const tool of tools) {
      const definition = JSON.stringify({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      })
      const properties = Object.entries(tool.inputSchema.properties ?? {}) as Array<[string, { description?: string }]>

      expect(tool.name).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
      expect(tool.description?.length, tool.name).toBeLessThanOrEqual(300)
      expect(definition.length, tool.name).toBeLessThanOrEqual(1_200)
      expect(
        properties.filter(([, property]) => !property.description).map(([name]) => name),
        tool.name
      ).toEqual([])
      expect(tool.annotations, tool.name).toEqual(
        expect.objectContaining({ readOnlyHint: expect.any(Boolean), openWorldHint: expect.any(Boolean) })
      )
      expect(tool.outputSchema, tool.name).toBeUndefined()
    }
  })

  it('answers requests already received before closing when stdin ends', async () => {
    const slow: Toolset = {
      name: 'slow',
      instructions: [],
      tools: [
        defineTool({
          name: 'slow',
          title: 'Slow',
          description: 'Answers after a delay.',
          input: { value: z.string() },
          annotations: { readOnlyHint: true },
          run: async ({ value }) => {
            await new Promise(resolve => setTimeout(resolve, 30))
            return textResult(value)
          }
        })
      ]
    }
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const output: string[] = []
    stdout.setEncoding('utf8').on('data', chunk => output.push(String(chunk)))

    const serving = serveOverStdio(createMcpServer({ version: '1.0.0', toolsets: [slow] }), stdin, stdout)
    stdin.end(
      [
        {
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
        },
        { method: 'notifications/initialized' },
        { id: 2, method: 'tools/call', params: { name: 'slow', arguments: { value: 'done' } } }
      ]
        .map(message => `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
        .join('')
    )
    await serving

    const responses = output
      .join('')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { id: number; result: Record<string, any> })
    expect(responses.map(response => response.id)).toEqual([1, 2])
    expect(responses[0].result.serverInfo.name).toBe(MCP_SERVER_NAME)
    expect(responses[1].result.content).toEqual([{ type: 'text', text: 'done' }])
  })

  it('stops instead of crashing when the client closes stdout', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const serving = serveOverStdio(createMcpServer({ version: '1.0.0', toolsets: [] }), stdin, stdout)
    await new Promise(resolve => setImmediate(resolve))
    stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    await expect(serving).resolves.toBeUndefined()
  })
})
