import { vi } from 'vitest'

export const DOCS = 'https://marketplace.gohighlevel.com/docs'
export const API_INDEX = `${DOCS}/llms/v3/llms.txt`
export const GUIDES = `${DOCS}/llms/guides.txt`

export const API_INDEX_TEXT = `# HighLevel API v3

> Index of HighLevel API version v3.

- Full compact reference of this version in one file: ${DOCS}/llms/v3/llms-full.txt

## contacts

- [contacts: all 2 endpoints, compact](${DOCS}/llms/v3/contacts.md): Contacts API v3
- [Get Contact](${DOCS}/ghl/contacts/get-contact.md): GET /contacts/{contactId} - Get Contact
- [Create Contact](${DOCS}/ghl/contacts/create-contact.md): POST /contacts/ - Create a contact

## calendars

- [Get Calendar Events](${DOCS}/ghl/calendars/get-calendar-events.md): GET /calendars/events - List calendar events
`

export const GUIDES_TEXT = `# HighLevel API guides

## Contents

- Scopes: ${DOCS}/Authorization/Scopes

---

# Scopes

Source: ${DOCS}/Authorization/Scopes

Scopes limit what an access token can do.

## Requesting scopes

Add every scope your app needs on the app's Auth page.

\`\`\`bash
# Example comment that is not a heading
curl https://services.leadconnectorhq.com
\`\`\`

## Contact scopes

Use contacts.readonly to read contacts and contacts.write to change them.

---

# Billing Webhook

Source: ${DOCS}/oauth/Billing

Marketplace billing sends a webhook when a payment succeeds.

## Signature verification

Verify the x-wh-signature header with the public key before trusting the payload.
`

export const CONTACTS_REFERENCE = `# HighLevel API v3: contacts

## Service: contacts (Contacts API v3)

### Get Contact
GET /contacts/{contactId}
Docs: ${DOCS}/ghl/contacts/get-contact | Markdown: ${DOCS}/ghl/contacts/get-contact.md

Auth: Sub-Account token: OAuth access token or Private Integration Token. Scopes: contacts.readonly

### Create Contact
POST /contacts/
Docs: ${DOCS}/ghl/contacts/create-contact | Markdown: ${DOCS}/ghl/contacts/create-contact.md

Auth: Sub-Account token: OAuth access token or Private Integration Token. Scopes: contacts.write
`

export const SCOPES_PAGE = `# Scopes

Scopes limit what an access token can do.

## Requesting scopes

Add every scope your app needs on the app's Auth page.

## Contact scopes

Use contacts.readonly to read contacts and contacts.write to change them.
`

export interface FakeResponse {
  status?: number
  body?: string
  headers?: Record<string, string>
}

export function textResponse({ status = 200, body = '', headers = {} }: FakeResponse = {}): Response {
  const contentType = status === 200 && !('content-type' in headers) ? { 'content-type': 'text/plain' } : {}
  return new Response(status === 304 ? null : body, { status, headers: { ...contentType, ...headers } })
}

/* A fetch double that answers each URL from a route table and records every
   request, so tests can assert both results and network behaviour. */
export function routeFetch(routes: Record<string, FakeResponse | (() => FakeResponse)>) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const route = routes[url]
    if (!route) return textResponse({ status: 404 })
    return textResponse(typeof route === 'function' ? route() : route)
  })
}

export function docsRoutes(extra: Record<string, FakeResponse> = {}): Record<string, FakeResponse> {
  return {
    [API_INDEX]: { body: API_INDEX_TEXT, headers: { etag: '"api-1"' } },
    [GUIDES]: { body: GUIDES_TEXT, headers: { etag: '"guides-1"' } },
    [`${DOCS}/Authorization/Scopes.md`]: { body: SCOPES_PAGE, headers: { 'content-type': 'text/markdown' } },
    [`${DOCS}/llms/v3/contacts.md`]: { body: CONTACTS_REFERENCE, headers: { 'content-type': 'text/markdown' } },
    [`${DOCS}/ghl/contacts/create-contact.md`]: {
      body: '# Create Contact\n\n' + 'Full OpenAPI page. '.repeat(500),
      headers: { 'content-type': 'text/markdown' }
    },
    ...extra
  }
}
