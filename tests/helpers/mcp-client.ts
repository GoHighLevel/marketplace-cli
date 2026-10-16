import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/* Connects a real MCP client to the server in memory, exercising the same
   protocol path (schema validation, results, errors) a stdio client uses. */
export async function connectClient(server: McpServer, user?: ConfirmingUser): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    user ? { capabilities: { elicitation: { form: {} } } } : undefined
  )
  if (user) {
    client.setRequestHandler(ElicitRequestSchema, async request => {
      user.questions.push(request.params.message)
      return { action: user.answer }
    })
  }
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

/* A client that can ask its user (MCP elicitation) and records what it asked. */
export interface ConfirmingUser {
  answer: 'accept' | 'decline' | 'cancel'
  questions: string[]
}

export function textOf(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? (result.content as Array<{ type: string; text?: string }>) : []
  return content
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join('\n')
}
