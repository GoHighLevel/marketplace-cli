import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineTool, errorResult, textResult } from '../../../src/lib/mcp/tool.js'
import { CodedError } from '../../../src/lib/shared/errors.js'
import { connectClient, textOf } from '../../helpers/mcp-client.js'

function serverWith(run: Parameters<typeof defineTool<{ value: z.ZodNumber }>>[0]['run']): McpServer {
  const server = new McpServer({ name: 'test', version: '1.0.0' })
  defineTool({
    name: 'double',
    title: 'Double',
    description: 'Doubles a value.',
    input: { value: z.number().int().max(10) },
    annotations: { readOnlyHint: true },
    run
  })(server)
  return server
}

describe('tool results', () => {
  it('returns compact text with no structured duplicate', () => {
    expect(textResult('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] })
  })

  it('maps coded, cancelled, and unexpected failures to error results', () => {
    expect(textOf(errorResult(new CodedError('DOC_NOT_FOUND', 'No page.')))).toBe('DOC_NOT_FOUND: No page.')
    const controller = new AbortController()
    controller.abort()
    expect(textOf(errorResult(new Error('aborted'), controller.signal))).toBe('CANCELLED: aborted')
    expect(errorResult('boom')).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'FAILED: The operation failed.' }]
    })
  })
})

describe('defineTool', () => {
  it('registers metadata, schemas, and annotations that clients can list', async () => {
    const client = await connectClient(serverWith(async ({ value }) => textResult(String(value * 2))))
    const { tools } = await client.listTools()

    expect(tools).toEqual([
      expect.objectContaining({
        name: 'double',
        title: 'Double',
        description: 'Doubles a value.',
        annotations: { readOnlyHint: true },
        inputSchema: expect.objectContaining({ required: ['value'] })
      })
    ])
  })

  it('passes validated input to the handler and returns its result', async () => {
    const client = await connectClient(serverWith(async ({ value }) => textResult(String(value * 2))))
    expect(textOf(await client.callTool({ name: 'double', arguments: { value: 4 } }))).toBe('8')
  })

  it('rejects invalid input before the handler runs', async () => {
    let calls = 0
    const client = await connectClient(
      serverWith(async () => {
        calls += 1
        return textResult('0')
      })
    )
    const result = await client.callTool({ name: 'double', arguments: { value: 99 } })
    expect(result.isError).toBe(true)
    expect(calls).toBe(0)
  })

  it('turns a thrown error into an error result instead of a protocol failure', async () => {
    const client = await connectClient(
      serverWith(async () => {
        throw new CodedError('DOCS_UNAVAILABLE', 'Offline.')
      })
    )
    const result = await client.callTool({ name: 'double', arguments: { value: 1 } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('DOCS_UNAVAILABLE: Offline.')
  })
})
