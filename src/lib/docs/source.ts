import { CodedError } from '../shared/errors.js'

const DOCS_HOST = 'marketplace.gohighlevel.com'
const DOCS_ORIGIN = `https://${DOCS_HOST}`
const DOCS_PATH_PREFIX = '/docs/'
const MAX_URL_LENGTH = 2048
const MAX_ANCHOR_LENGTH = 200

/* LLM-oriented indexes published with the docs build: the API index links
   every endpoint page and the guides file inlines every guide page. */
export const API_INDEX_URL = `${DOCS_ORIGIN}/docs/llms/v3/llms.txt`
export const GUIDES_URL = `${DOCS_ORIGIN}/docs/llms/guides.txt`

export interface DocLocation {
  /* Canonical Markdown URL without a fragment. */
  url: string
  /* Heading slug that selects one section of the page. */
  anchor?: string
}

/* Only HighLevel's public developer docs are reachable, so a prompt-injected
   URL can never turn documentation tools into a general web client. */
export function isDocsUrl(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname === DOCS_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname.startsWith(DOCS_PATH_PREFIX) &&
    url.pathname.length > DOCS_PATH_PREFIX.length
  )
}

/* Docs pages are served as Markdown next to their HTML routes; HTML routes
   redirect to an `index.html` shell that carries no content. */
function markdownPathname(pathname: string): string {
  if (/\.(?:md|txt)$/i.test(pathname)) return pathname
  const route = pathname
    .replace(/\/index\.html?$/i, '')
    .replace(/\.html?$/i, '')
    .replace(/\/+$/, '')
  return `${route}.md`
}

function decodeAnchor(hash: string): string | undefined {
  if (hash.length <= 1) return undefined
  let anchor: string
  try {
    anchor = decodeURIComponent(hash.slice(1))
  } catch {
    return undefined
  }
  const normalized = anchor.trim().toLowerCase()
  return normalized && normalized.length <= MAX_ANCHOR_LENGTH ? normalized : undefined
}

export function resolveDocUrl(input: string): DocLocation {
  const invalid = new CodedError(
    'INVALID_DOC_URL',
    `Only ${DOCS_ORIGIN}${DOCS_PATH_PREFIX} documentation URLs can be fetched.`
  )
  if (input.length > MAX_URL_LENGTH) throw invalid

  let parsed: URL
  try {
    parsed = new URL(input.trim())
  } catch {
    throw invalid
  }
  if (!isDocsUrl(parsed)) throw invalid

  const markdown = new URL(markdownPathname(parsed.pathname), DOCS_ORIGIN)
  if (!isDocsUrl(markdown)) throw invalid

  const anchor = decodeAnchor(parsed.hash)
  return anchor ? { url: markdown.href, anchor } : { url: markdown.href }
}

export function formatDocUrl(location: DocLocation): string {
  return location.anchor ? `${location.url}#${location.anchor}` : location.url
}
