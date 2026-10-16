import { extractSection, extractSectionContaining, sectionAnchors, sliceText } from './markdown.js'
import { type DocLocation, formatDocUrl } from './source.js'

export interface PageContent {
  /* URL the content is attributed to, with an anchor for a single section. */
  url: string
  text: string
  /* The full page when `text` may be only part of it; its other sections are
     listed whenever less than the whole page is returned. */
  page?: string
  note?: string
}

export interface DocPage {
  url: string
  content: string
  startIndex: number
  endIndex: number
  totalLength: number
  nextStartIndex?: number
  note?: string
  /* Other section anchors, listed whenever the page was not returned whole. */
  outline?: string[]
  /* Why this page of a batch could not be read; the others are still returned. */
  error?: string
}

/* Pages up to this size (about 3k tokens) are returned whole even for an
   anchored URL: one slightly larger result is cheaper than a second call. */
export const WHOLE_PAGE_LIMIT = 12_000
const MAX_OUTLINE_ANCHORS = 20

/* Picks the part of a page that answers a request: small pages whole, the
   anchored section of a large page, or the page with a note when the anchor
   no longer exists. */
export function selectPageContent(location: DocLocation, page: string): PageContent {
  if (!location.anchor || page.length <= WHOLE_PAGE_LIMIT) return { url: location.url, text: page, page }
  const section = extractSection(page, location.anchor)
  if (section) return { url: formatDocUrl(location), text: section, page }
  return { url: location.url, text: page, page, note: `Section #${location.anchor} was not found; showing the page.` }
}

/* Compact references list each endpoint under a `### Title` heading that
   links back to the endpoint's own Markdown page. */
export function compactEndpointSection(reference: string, pageUrl: string): string | undefined {
  const marker = `Markdown: ${pageUrl}`
  return extractSectionContaining(reference, 3, line => {
    const index = line.indexOf(marker)
    return index !== -1 && /^(?:\s|$)/.test(line.slice(index + marker.length))
  })
}

/* Shares a character budget so short documents are returned whole and the
   remainder is split evenly among the longer ones. */
export function allocateBudget(sizes: readonly number[], budget: number): number[] {
  const order = sizes.map((size, index) => ({ size, index })).sort((left, right) => left.size - right.size)
  const allocation = new Array<number>(sizes.length).fill(0)
  let remaining = budget
  order.forEach(({ size, index }, position) => {
    const share = Math.floor(remaining / (order.length - position))
    allocation[index] = Math.min(size, share)
    remaining -= allocation[index]
  })
  return allocation
}

function outline(page: string, url: string): string[] {
  return sectionAnchors(page)
    .filter(anchor => !url.endsWith(`#${anchor}`))
    .slice(0, MAX_OUTLINE_ANCHORS)
}

export function toDocPage(content: PageContent, startIndex: number, budget: number): DocPage {
  const slice = sliceText(content.text, startIndex, budget)
  const truncated = slice.startIndex > 0 || slice.nextStartIndex !== undefined
  const partial = content.page !== undefined && (truncated || content.text !== content.page)
  const anchors = partial && content.page ? outline(content.page, content.url) : []
  return {
    url: content.url,
    ...slice,
    ...(content.note ? { note: content.note } : {}),
    ...(anchors.length > 0 ? { outline: anchors } : {})
  }
}

export function failedPage(url: string, error: string): DocPage {
  return { url, content: '', startIndex: 0, endIndex: 0, totalLength: 0, error }
}

function pageOf(url: string): string {
  return url.split('#')[0]
}

/* Several sections of one page in a batch share one outline: it is listed
   once, after the page's last section, without the sections already shown. */
export function mergeOutlines(pages: readonly DocPage[]): DocPage[] {
  const shown = new Map<string, Set<string>>()
  const lastIndex = new Map<string, number>()
  pages.forEach((page, index) => {
    const anchors = shown.get(pageOf(page.url)) ?? new Set<string>()
    const anchor = page.url.split('#')[1]
    if (anchor) anchors.add(anchor)
    shown.set(pageOf(page.url), anchors)
    lastIndex.set(pageOf(page.url), index)
  })
  return pages.map((page, index) => {
    const { outline: pageOutline, ...rest } = page
    const base = pageOf(page.url)
    const remaining = (pageOutline ?? []).filter(anchor => !shown.get(base)?.has(anchor))
    return lastIndex.get(base) === index && remaining.length > 0 ? { ...rest, outline: remaining } : rest
  })
}
