import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DocsService } from '../../../../src/lib/docs/service.js'
import { createMcpServer } from '../../../../src/lib/mcp/server.js'
import { docsToolset } from '../../../../src/lib/mcp/tools/docs.js'
import { DOCS, docsRoutes, routeFetch } from '../../../helpers/docs-fetch.js'
import { connectClient, textOf } from '../../../helpers/mcp-client.js'

const LONG_PAGE = `${DOCS}/long.md`
const BIG_PAGE = `${DOCS}/big.md`
const BIG_PAGE_TEXT = `# Big\n\n## Setup\n\nInstall.\n\n## Usage\n\nCall it.\n\n## Appendix\n\n${'x'.repeat(13_000)}\n`
let cacheDir: string
let client: Client

beforeEach(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-docs-tools-'))
  const docs = new DocsService({
    cacheDir,
    userAgent: 'ghl-test',
    fetch: routeFetch(docsRoutes({ [LONG_PAGE]: { body: 'line\n'.repeat(500) }, [BIG_PAGE]: { body: BIG_PAGE_TEXT } })),
    now: () => 0
  })
  client = await connectClient(createMcpServer({ version: '1.0.0', toolsets: [docsToolset(docs)] }))
})

afterEach(async () => {
  await client.close()
  await fs.rm(cacheDir, { recursive: true, force: true })
})

describe('docs toolset', () => {
  it('teaches clients the shortest path: one search, then at most one batched fetch', () => {
    expect(client.getInstructions()).toMatch(
      /For a known endpoint, call fetch-doc[\s\S]*call search-docs once[\s\S]*call fetch-doc once with every page you need/
    )
  })

  it('search-docs returns a compact numbered list instead of JSON', async () => {
    const result = await client.callTool({
      name: 'search-docs',
      arguments: { query: 'verify webhook signature', limit: 1, kind: 'guide' }
    })

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toBeUndefined()
    expect(textOf(result)).toBe(
      `1. Billing Webhook › Signature verification\n${DOCS}/oauth/Billing.md#signature-verification\n` +
        'Verify the x-wh-signature header with the public key before trusting the payload.'
    )
  })

  it('search-docs shows the endpoint and skips an excerpt that repeats the title', async () => {
    const result = await client.callTool({ name: 'search-docs', arguments: { query: 'GET /contacts/{id}', limit: 1 } })
    expect(textOf(result)).toBe(`1. Get Contact (GET /contacts/{contactId})\n${DOCS}/ghl/contacts/get-contact.md`)
  })

  it('search-docs explains an empty result and validates its arguments', async () => {
    const empty = await client.callTool({ name: 'search-docs', arguments: { query: 'zzzz qqqq' } })
    expect(textOf(empty)).toMatch(/^No documentation matched "zzzz qqqq"\./)

    const invalid = await client.callTool({ name: 'search-docs', arguments: { query: 'x', limit: 50 } })
    expect(invalid.isError).toBe(true)
  })

  it('fetch-doc reads several URLs in one call, each with its source', async () => {
    const result = await client.callTool({
      name: 'fetch-doc',
      arguments: { pages: [`${DOCS}/Authorization/Scopes.md#contact-scopes`, `${DOCS}/ghl/contacts/create-contact.md`] }
    })
    const [scopes, endpoint] = textOf(result).split('\n\n---\n\n')

    expect(scopes.startsWith(`Source: ${DOCS}/Authorization/Scopes.md\n\n# Scopes`)).toBe(true)
    expect(endpoint).toMatch(/^Source: .*create-contact\.md\n\n### Create Contact\nPOST \/contacts\//)
  })

  it('fetch-doc lists the other sections of a large page once, and how to continue a truncated page', async () => {
    const section = await client.callTool({ name: 'fetch-doc', arguments: { pages: [`${BIG_PAGE}#usage`] } })
    expect(textOf(section)).toBe(
      `Source: ${BIG_PAGE}#usage\n\n## Usage\n\nCall it.\n\n[More sections: #setup #appendix]`
    )

    const paged = await client.callTool({ name: 'fetch-doc', arguments: { pages: [LONG_PAGE], maxLength: 2_000 } })
    expect(textOf(paged)).toContain(
      `[Showing characters 0-2000 of 2500. To continue, call fetch-doc with pages ["${LONG_PAGE}"] and startIndex 2000.]`
    )
  })

  it('fetch-doc reads a known endpoint directly and suggests the closest ones for an unknown endpoint', async () => {
    const known = await client.callTool({ name: 'fetch-doc', arguments: { pages: ['POST /contacts'] } })
    expect(textOf(known)).toMatch(/^Source: .*create-contact\.md\n\n### Create Contact\nPOST \/contacts\//)

    const unknown = await client.callTool({ name: 'fetch-doc', arguments: { pages: ['POST /contacts/create'] } })
    expect(unknown.isError).toBe(true)
    expect(textOf(unknown)).toMatch(
      /^ENDPOINT_NOT_FOUND: No documented endpoint matches "POST \/contacts\/create"\. Closest: POST \/contacts\/ \(Create Contact\)/
    )
  })

  it('fetch-doc reports a failed page in place and still returns the rest of the batch', async () => {
    const result = await client.callTool({
      name: 'fetch-doc',
      arguments: { pages: [`${DOCS}/missing.md`, `${DOCS}/ghl/contacts/create-contact.md`] }
    })
    const [missing, endpoint] = textOf(result).split('\n\n---\n\n')

    expect(result.isError).toBeFalsy()
    expect(missing).toMatch(new RegExp(`^Source: ${DOCS}/missing\\.md\\nDOC_NOT_FOUND: `))
    expect(endpoint).toContain('### Create Contact')
  })

  it('fetch-doc refuses URLs outside the docs and more than five pages', async () => {
    const outside = await client.callTool({
      name: 'fetch-doc',
      arguments: { pages: ['https://evil.example.com/a.md'] }
    })
    expect(outside.isError).toBe(true)
    expect(textOf(outside)).toMatch(/^INVALID_DOC_URL: /)

    const tooMany = await client.callTool({ name: 'fetch-doc', arguments: { pages: Array(6).fill(LONG_PAGE) } })
    expect(tooMany.isError).toBe(true)
  })
})
