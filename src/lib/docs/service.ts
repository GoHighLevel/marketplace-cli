import { CodedError, codedErrorText } from '../shared/errors.js'
import { isFresh, loadCachedText } from './cache.js'
import { type DocEntry, type DocKind, parseApiIndex, parseGuides } from './catalog.js'
import { cliDocEntries, cliDocText, isCliDocUrl, resolveCliDocUrl } from './cli-guides.js'
import { downloadDocText } from './download.js'
import { excerptAround } from './markdown.js'
import {
  allocateBudget,
  compactEndpointSection,
  type DocPage,
  failedPage,
  mergeOutlines,
  type PageContent,
  selectPageContent,
  toDocPage
} from './pages.js'
import {
  buildSearchIndex,
  type EndpointTarget,
  findEndpoints,
  parseEndpointReference,
  type SearchIndex,
  searchIndex
} from './search.js'
import { API_INDEX_URL, type DocLocation, formatDocUrl, GUIDES_URL, resolveDocUrl } from './source.js'

export interface DocsServiceOptions {
  cacheDir: string
  userAgent: string
  fetch?: typeof fetch
  now?: () => number
  indexMaxAgeMs?: number
}

export interface DocSearchQuery {
  query: string
  limit: number
  kind?: DocKind
}

export interface DocSearchResult {
  title: string
  url: string
  kind: DocKind
  section: string
  method?: string
  path?: string
  excerpt: string
}

export interface DocSearchResponse {
  query: string
  total: number
  results: DocSearchResult[]
  indexedAt: string
  stale: boolean
}

export interface DocPagesRequest {
  /* Docs URLs or endpoint request lines such as `POST /contacts/`. */
  pages: readonly string[]
  /* Continues a single truncated page. */
  startIndex: number
  /* Character budget shared by every requested page. */
  maxLength: number
}

interface LoadedIndex {
  index: SearchIndex
  /* Endpoint page URL -> its service's compact reference URL. */
  references: ReadonlyMap<string, string>
  fetchedAt: number
  loadedAt: number
  stale: boolean
}

interface CachedPage {
  text: Promise<string>
  fetchedAt: number
}

/* One page to read, or why a requested page could not be resolved. */
type PageTarget = { location: DocLocation } | { input: string; error: unknown }

type PageResult = PageContent | { input: string; error: unknown }

const DEFAULT_INDEX_MAX_AGE_MS = 6 * 60 * 60 * 1000
const STALE_INDEX_RETRY_MS = 5 * 60 * 1000
const PAGE_CACHE_TTL_MS = 5 * 60 * 1000
const PAGE_CACHE_SIZE = 16
const PAGE_MAX_BYTES = 2 * 1024 * 1024
/* The top result is the likeliest answer, so it gets enough text to answer
   from directly; the rest only need enough to choose what to fetch. */
const TOP_EXCERPT_LENGTH = 420
const EXCERPT_LENGTH = 200
const ENDPOINT_SUGGESTIONS = 3
const ENDPOINT_CANDIDATES = 10

function toSearchResult(entry: DocEntry, rank: number, terms: readonly string[]): DocSearchResult {
  return {
    title: entry.title,
    url: entry.url,
    kind: entry.kind,
    section: entry.section,
    ...(entry.method ? { method: entry.method } : {}),
    ...(entry.path ? { path: entry.path } : {}),
    excerpt: excerptAround(entry.text, terms, rank === 0 ? TOP_EXCERPT_LENGTH : EXCERPT_LENGTH)
  }
}

function isFailure(result: PageResult | PageTarget): result is { input: string; error: unknown } {
  return 'error' in result
}

function uniqueTargets(targets: readonly PageTarget[]): PageTarget[] {
  const unique = new Map(
    targets.map(target => [isFailure(target) ? `\0${target.input}` : formatDocUrl(target.location), target])
  )
  return [...unique.values()]
}

function endpointLabel(entry: DocEntry): string {
  return `${entry.method} ${entry.path} (${entry.title})`
}

/* Searches and reads HighLevel's public developer docs. The search index is
   built from the published LLM indexes, cached on disk between processes and
   in memory for the life of this instance. */
export class DocsService {
  private loading?: Promise<LoadedIndex>
  private readonly pages = new Map<string, CachedPage>()

  constructor(private readonly options: DocsServiceOptions) {}

  async search(request: DocSearchQuery, signal?: AbortSignal): Promise<DocSearchResponse> {
    const loaded = await this.loadIndex()
    signal?.throwIfAborted()
    const outcome = searchIndex(loaded.index, request.query, { limit: request.limit, kind: request.kind })
    return {
      query: request.query,
      total: outcome.total,
      results: outcome.hits.map((hit, rank) => toSearchResult(hit.entry, rank, outcome.terms)),
      indexedAt: new Date(loaded.fetchedAt).toISOString(),
      stale: loaded.stale
    }
  }

  /* Reads up to several pages in one call, sharing one character budget. A
     page that fails is reported in place so the rest of the batch still
     answers; only a batch where every page fails is an error. */
  async fetchPages(request: DocPagesRequest, signal?: AbortSignal): Promise<DocPage[]> {
    const targets = await this.resolveTargets(request.pages)
    if (request.startIndex > 0 && targets.length > 1) {
      throw new CodedError('INVALID_INPUT', 'startIndex continues one truncated page; pass only that page.')
    }
    const results = await Promise.all(targets.map(target => this.readTarget(target)))
    signal?.throwIfAborted()
    const failures = results.filter(isFailure)
    if (failures.length === results.length) throw failures[0].error
    const budgets = allocateBudget(
      results.map(result => (isFailure(result) ? 0 : Math.max(0, result.text.length - request.startIndex))),
      request.maxLength
    )
    return mergeOutlines(
      results.map((result, index) =>
        isFailure(result)
          ? failedPage(result.input, codedErrorText(result.error, 'DOCS_UNAVAILABLE'))
          : toDocPage(result, request.startIndex, budgets[index])
      )
    )
  }

  private async resolveTargets(inputs: readonly string[]): Promise<PageTarget[]> {
    const resolved = await Promise.all(
      inputs.map(async (input): Promise<PageTarget[]> => {
        try {
          return (await this.resolvePage(input)).map(location => ({ location }))
        } catch (error) {
          return [{ input, error }]
        }
      })
    )
    return uniqueTargets(resolved.flat())
  }

  private async readTarget(target: PageTarget): Promise<PageResult> {
    if (isFailure(target)) return target
    try {
      return await this.pageContent(target.location)
    } catch (error) {
      return { input: formatDocUrl(target.location), error }
    }
  }

  /* An endpoint request line resolves to every documented page it names, so
     a known endpoint needs no search first. */
  private async resolvePage(input: string): Promise<DocLocation[]> {
    if (isCliDocUrl(input)) return [resolveCliDocUrl(input)]
    const endpoint = parseEndpointReference(input)
    if (!endpoint) return [resolveDocUrl(input)]
    const { index } = await this.loadIndex()
    const matches = findEndpoints(index, endpoint)
    if (matches.length === 0) throw this.endpointNotFound(index, input, endpoint)
    return matches.map(entry => ({ url: entry.url }))
  }

  private endpointNotFound(index: SearchIndex, input: string, endpoint: EndpointTarget): CodedError {
    /* The method stays out of the text query: "post" would match blog posts. */
    const sameMethodFirst = (entry: DocEntry) => (endpoint.method && entry.method !== endpoint.method ? 1 : 0)
    const closest = searchIndex(index, endpoint.path, { limit: ENDPOINT_CANDIDATES, kind: 'api' })
      .hits.map(hit => hit.entry)
      .sort((left, right) => sameMethodFirst(left) - sameMethodFirst(right))
      .slice(0, ENDPOINT_SUGGESTIONS)
      .map(endpointLabel)
    const suggestion = closest.length > 0 ? ` Closest: ${closest.join('; ')}.` : ''
    return new CodedError('ENDPOINT_NOT_FOUND', `No documented endpoint matches "${input.trim()}".${suggestion}`)
  }

  /* Endpoint pages are answered from their service's compact reference, which
     carries the same auth, parameters, and schemas in a fraction of the size. */
  private async pageContent(location: DocLocation): Promise<PageContent> {
    const local = cliDocText(location.url)
    if (local !== undefined) return selectPageContent(location, local)
    const reference = location.anchor ? undefined : (await this.endpointReferences()).get(location.url)
    if (reference) {
      const section = compactEndpointSection(await this.pageText(reference), location.url)
      if (section) return { url: location.url, text: section }
    }
    return selectPageContent(location, await this.pageText(location.url))
  }

  /* Without an index the endpoint page itself is still a correct answer. */
  private async endpointReferences(): Promise<ReadonlyMap<string, string>> {
    const loaded = await this.loadIndex().catch(() => undefined)
    return loaded?.references ?? new Map()
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private maxAge(): number {
    return this.options.indexMaxAgeMs ?? DEFAULT_INDEX_MAX_AGE_MS
  }

  /* Expiry runs from the in-memory load, not the documents' age, so an
     offline fallback retries the network occasionally instead of on every
     search. */
  private isCurrent(loaded: LoadedIndex): boolean {
    const lifetime = loaded.stale ? Math.min(STALE_INDEX_RETRY_MS, this.maxAge()) : this.maxAge()
    return isFresh(loaded.loadedAt, this.now(), lifetime)
  }

  /* Concurrent searches share one load; a failed first load is retried next
     time and an expired index is rebuilt from the (revalidated) disk cache. */
  private async loadIndex(): Promise<LoadedIndex> {
    const current = this.loading
    const previous = current ? await current.catch(() => undefined) : undefined
    if (previous && this.isCurrent(previous)) return previous
    if (current && this.loading !== current) return this.loadIndex()

    const next = this.rebuildIndex(previous)
    this.loading = next
    next.catch(() => {
      if (this.loading === next) this.loading = undefined
    })
    return next
  }

  /* A failed rebuild keeps serving the last good index, marked stale. */
  private async rebuildIndex(previous: LoadedIndex | undefined): Promise<LoadedIndex> {
    try {
      return await this.buildIndex()
    } catch (error) {
      if (!previous) throw error
      return { ...previous, loadedAt: this.now(), stale: true }
    }
  }

  private async buildIndex(): Promise<LoadedIndex> {
    const load = (url: string) =>
      loadCachedText(url, {
        cacheDir: this.options.cacheDir,
        maxAgeMs: this.maxAge(),
        userAgent: this.options.userAgent,
        fetch: this.options.fetch,
        now: this.options.now
      })
    const [api, guides] = await Promise.all([load(API_INDEX_URL), load(GUIDES_URL)])
    const published = [...parseGuides(guides.text), ...parseApiIndex(api.text)]
    if (published.length === 0) throw new CodedError('DOCS_UNAVAILABLE', 'The documentation index is empty.')
    const entries = [...published, ...cliDocEntries()]
    return {
      index: buildSearchIndex(entries),
      references: new Map(entries.flatMap(entry => (entry.reference ? [[entry.url, entry.reference] as const] : []))),
      fetchedAt: Math.min(api.fetchedAt, guides.fetchedAt),
      loadedAt: this.now(),
      stale: api.stale || guides.stale
    }
  }

  /* Pagination re-reads the same page, so recent pages stay in memory, and
     concurrent reads of one page share a single download. */
  private pageText(url: string): Promise<string> {
    const cached = this.pages.get(url)
    if (cached && isFresh(cached.fetchedAt, this.now(), PAGE_CACHE_TTL_MS)) return cached.text

    const text = this.downloadPage(url)
    this.rememberPage(url, { text, fetchedAt: this.now() })
    text.catch(() => {
      if (this.pages.get(url)?.text === text) this.pages.delete(url)
    })
    return text
  }

  private async downloadPage(url: string): Promise<string> {
    const result = await downloadDocText(url, {
      userAgent: this.options.userAgent,
      fetch: this.options.fetch,
      maxBytes: PAGE_MAX_BYTES
    })
    if (result.status !== 'modified') throw new CodedError('DOCS_UNAVAILABLE', `${url} returned no content.`)
    return result.text
  }

  private rememberPage(url: string, page: CachedPage): void {
    this.pages.delete(url)
    this.pages.set(url, page)
    const oldest = this.pages.keys().next()
    if (this.pages.size > PAGE_CACHE_SIZE && !oldest.done) this.pages.delete(oldest.value)
  }
}
