import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'

import { codedErrorText } from '../shared/errors.js'

/* The user's answer: accept, decline, or cancel when the dialog was closed
   without an answer (headless clients close it without showing it). */
export type Confirmation = 'accept' | 'decline' | 'cancel'

export interface ToolContext {
  signal: AbortSignal
  /* Asks the user directly through the client (MCP elicitation), so the model
     can neither see nor answer the question. Resolves to undefined when the
     client cannot ask. */
  confirm: (message: string) => Promise<Confirmation | undefined>
}

export interface ToolSpec<Input extends z.ZodRawShape> {
  name: string
  title: string
  description: string
  input: Input
  annotations: ToolAnnotations
  run: (input: z.infer<z.ZodObject<Input>>, context: ToolContext) => Promise<CallToolResult>
}

/* Binds a tool to a server; keeps heterogeneous tool specs in one list. */
export type ToolRegistration = (server: McpServer) => void

/* A group of related tools plus the server-instruction lines that teach a
   client when and in which order to call them. */
export interface Toolset {
  name: string
  instructions: readonly string[]
  tools: readonly ToolRegistration[]
}

/* Results are compact text written for the model. JSON envelopes repeat
   field names in every item and some clients pass both forms to the model;
   see src/lib/mcp/GUIDELINES.md. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

/* Failures are tool results, not protocol errors, so the model can read the
   code and recover (for example by fixing an argument). */
export function errorResult(error: unknown, signal?: AbortSignal): CallToolResult {
  const text = codedErrorText(error, signal?.aborted ? 'CANCELLED' : 'FAILED')
  return { isError: true, content: [{ type: 'text', text }] }
}

function confirmation(server: McpServer, signal: AbortSignal): ToolContext['confirm'] {
  return async message => {
    if (!server.server.getClientCapabilities()?.elicitation?.form) return undefined
    const answer = await server.server.elicitInput(
      { mode: 'form', message, requestedSchema: { type: 'object', properties: {} } },
      { signal }
    )
    return answer.action
  }
}

export function defineTool<Input extends z.ZodRawShape>(spec: ToolSpec<Input>): ToolRegistration {
  /* The SDK validates arguments against this shape before the callback runs,
     which is what makes the narrowing cast below sound. */
  const inputSchema: Readonly<Record<string, z.core.$ZodType>> = spec.input
  return server => {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema,
        annotations: spec.annotations
      },
      async (input, extra) => {
        try {
          return await spec.run(input as z.infer<z.ZodObject<Input>>, {
            signal: extra.signal,
            confirm: confirmation(server, extra.signal)
          })
        } catch (error) {
          return errorResult(error, extra.signal)
        }
      }
    )
  }
}
