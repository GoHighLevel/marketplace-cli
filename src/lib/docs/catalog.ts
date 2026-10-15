import { findHeadings, headingText, type MarkdownHeading, toPlainText } from './markdown.js'
import { formatDocUrl, resolveDocUrl } from './source.js'

export const DOC_KINDS = ['guide', 'api', 'cli'] as const

export type DocKind = (typeof DOC_KINDS)[number]

export interface DocEntry {
  kind: DocKind
  title: string
  /* Canonical Markdown URL, with a `#anchor` for a section of a page. */
  url: string
  /* Guide category or API service. */
  section: string
  method?: string
  path?: string
  /* For API endpoints: the compact per-service reference that documents the
     endpoint in a fraction of the page's size. */
  reference?: string
  /* Plain text used for ranking and excerpts. */
  text: string
}

export interface GuidePage {
  title: string
  url: string
  /* The `# Title` line followed by the page body. */
  lines: string[]
}

const INDEX_LINK = /^- \[(.+?)\]\((https:\/\/[^)\s]+)\)(?::\s*(.*))?$/
const ENDPOINT = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)(?:\s+-\s+(.*))?$/
const SERVICE_HEADING = /^##\s+(.+?)\s*$/
const SERVICE_REFERENCE_TITLE = /: all \d+ endpoints?, compact$/i
const SOURCE_LINE = /^Source:\s*(https:\/\/\S+)\s*$/
const SOURCE_LOOKAHEAD_LINES = 3
const SECTION_HEADING_LEVELS = new Set([2, 3])

/* Guide URLs are grouped by their first path segment under /docs/. */
const GUIDE_CATEGORIES: Readonly<Record<string, string>> = {
  Authorization: 'Authorization',
  MarketplacePolicies: 'Marketplace policies',
  'marketplace-modules': 'Marketplace modules',
  oauth: 'Marketplace apps',
  other: 'Other',
  sdk: 'SDKs',
  webhook: 'Webhooks'
}

function canonicalUrl(url: string): string | undefined {
  try {
    return resolveDocUrl(url).url
  } catch {
    return undefined
  }
}

interface ServiceContext {
  name: string
  reference?: string
}

function apiEntry(title: string, url: string, service: ServiceContext, detail: string): DocEntry {
  const endpoint = ENDPOINT.exec(detail)
  const base = { kind: 'api' as const, title, url, section: service.name }
  const reference = service.reference ? { reference: service.reference } : {}
  if (!endpoint) return { ...base, ...reference, text: detail }
  const [, method, path, summary = ''] = endpoint
  return { ...base, method, path, ...reference, text: summary }
}

/* Parses the versioned API index: `## service` headings, the service's
   compact reference link, then one `- [Title](url): METHOD /path - summary`
   line per endpoint. The compact reference itself is not an entry: it bundles
   every endpoint of a service and is far too large to return as a result. */
export function parseApiIndex(text: string): DocEntry[] {
  const entries: DocEntry[] = []
  let service: ServiceContext | undefined
  for (const line of text.split(/\r?\n/)) {
    const heading = SERVICE_HEADING.exec(line)
    if (heading) {
      service = { name: heading[1] }
      continue
    }
    const link = INDEX_LINK.exec(line)
    const url = link && service ? canonicalUrl(link[2]) : undefined
    if (!link || !url || !service) continue
    if (SERVICE_REFERENCE_TITLE.test(link[1])) service = { ...service, reference: url }
    else entries.push(apiEntry(headingText(link[1]), url, service, link[3]?.trim() ?? ''))
  }
  return entries
}

function guideCategory(url: string): string {
  const [first, ...rest] = new URL(url).pathname.split('/').slice(2)
  if (rest.length === 0) return 'Getting started'
  return Object.hasOwn(GUIDE_CATEGORIES, first) ? GUIDE_CATEGORIES[first] : first
}

function sourceUrlAfter(lines: readonly string[], line: number): { url: string; line: number } | undefined {
  for (let index = line + 1; index <= line + SOURCE_LOOKAHEAD_LINES && index < lines.length; index += 1) {
    const source = SOURCE_LINE.exec(lines[index])
    const url = source ? canonicalUrl(source[1]) : undefined
    if (url) return { url, line: index }
  }
  return undefined
}

/* The guides file inlines every page as `# Title` + `Source: <url>`; the
   page runs until the next such pair. Each page keeps its title line so
   repeated-heading anchors are numbered exactly as on the published page. */
function splitGuidePages(lines: readonly string[], headings: readonly MarkdownHeading[]): GuidePage[] {
  const starts = headings
    .filter(heading => heading.level === 1)
    .flatMap(heading => {
      const source = sourceUrlAfter(lines, heading.line)
      return source ? [{ title: heading.text, url: source.url, line: heading.line, bodyStart: source.line + 1 }] : []
    })
  return starts.map((start, index) => ({
    title: start.title,
    url: start.url,
    lines: [
      lines[start.line],
      ...lines.slice(start.bodyStart, starts[index + 1]?.line ?? lines.length).filter(line => line.trim() !== '---')
    ]
  }))
}

interface PageEntryContext {
  kind: DocKind
  section: string
}

function pageEntry(
  page: GuidePage,
  context: PageEntryContext,
  lines: readonly string[],
  heading?: MarkdownHeading
): DocEntry {
  return {
    kind: context.kind,
    title: heading ? `${page.title} › ${heading.text}` : page.title,
    url: heading ? formatDocUrl({ url: page.url, anchor: heading.anchor }) : page.url,
    section: context.section,
    text: toPlainText(lines.join('\n'))
  }
}

/* One entry for each page introduction and each level-2/3 section, so a
   search can point at the exact part of a long guide. The introduction is
   kept even when empty so the page stays findable by its title. */
export function pageEntries(page: GuidePage, context: PageEntryContext): DocEntry[] {
  const sections = findHeadings(page.lines).filter(heading => SECTION_HEADING_LEVELS.has(heading.level))
  const introduction = page.lines.slice(1, sections[0]?.line ?? page.lines.length)
  const entries = [pageEntry(page, context, introduction)]
  sections.forEach((heading, index) => {
    const body = page.lines.slice(heading.line + 1, sections[index + 1]?.line ?? page.lines.length)
    const entry = pageEntry(page, context, body, heading)
    if (entry.text) entries.push(entry)
  })
  return entries
}

export function parseGuides(text: string): DocEntry[] {
  const lines = text.split(/\r?\n/)
  return splitGuidePages(lines, findHeadings(lines)).flatMap(page =>
    pageEntries(page, { kind: 'guide', section: guideCategory(page.url) })
  )
}
