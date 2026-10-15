import type { DocEntry, DocKind } from './catalog.js'

export interface SearchIndex {
  documents: IndexedDocument[]
  documentFrequency: ReadonlyMap<string, number>
  averageLength: number
}

export interface SearchOptions {
  limit: number
  kind?: DocKind
  maxPerPage?: number
}

export interface SearchHit {
  entry: DocEntry
  score: number
}

export interface SearchOutcome {
  hits: SearchHit[]
  total: number
  terms: string[]
}

interface IndexedDocument {
  entry: DocEntry
  frequencies: ReadonlyMap<string, number>
  length: number
  /* Space-delimited title tokens, for whole-phrase matching. */
  titleTerms: string
  /* Lower-cased title, path, and text, for exact identifier matches. */
  haystack: string
  apiPath?: string
}

export interface EndpointTarget {
  method?: string
  path: string
}

/* Title and endpoint paths carry more signal than body text. */
const FIELD_WEIGHTS = { title: 3, path: 2, section: 1, text: 1 } as const
const BM25_K1 = 1.2
const BM25_B = 0.75
const TITLE_PHRASE_BOOST = 1.5
const IDENTIFIER_BOOST = 0.6
/* Hyphen, dot, or underscore compounds such as `X-GHL-Signature`,
   `contacts.write`, or `field_value`: tokenizing splits them into common
   words, so an exact match is the strongest signal in technical docs. */
const IDENTIFIER = /[A-Za-z][A-Za-z0-9]*(?:[-._][A-Za-z0-9]+)+/g
const ENDPOINT_MATCH_BONUS = 25
const TEMPLATE_MATCH_WEIGHT = 0.8
const METHOD_MISMATCH_WEIGHT = 0.5
const DEFAULT_MAX_PER_PAGE = 2
const ENDPOINT_QUERY = /(?:^|\s)(?:(GET|POST|PUT|PATCH|DELETE)\s+)?(\/[\w{}:/.-]+)/i
/* A whole request line: `POST /contacts/`, `/contacts/{id}`, or the API URL
   copied from code, such as `GET https://services.leadconnectorhq.com/contacts/x?a=b`. */
const ENDPOINT_REFERENCE =
  /^(?:(GET|POST|PUT|PATCH|DELETE)\s+)?(?:https:\/\/services\.leadconnectorhq\.com)?(\/[\w{}:/.-]*)(?:\?\S*)?$/i
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'what',
  'when',
  'which',
  'with'
])

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 3 && token.endsWith('s') && !/(?:ss|us|is)$/.test(token)) return token.slice(0, -1)
  return token
}

/* Splits camelCase and path segments so `/contacts/{contactId}` matches
   "contact id", then drops stopwords and plural endings. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length > 1 && !STOPWORDS.has(token))
    .map(stem)
}

/* Path parameters are compared structurally: `{contactId}` and `:id` match. */
export function normalizeApiPath(path: string): string {
  return path
    .toLowerCase()
    .replace(/\{[^}]*\}|:[\w-]+/g, '{}')
    .replace(/\/+$/, '')
}

function addWeighted(frequencies: Map<string, number>, text: string | undefined, weight: number): number {
  const tokens = tokenize(text ?? '')
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + weight)
  return tokens.length * weight
}

function indexDocument(entry: DocEntry): IndexedDocument {
  const frequencies = new Map<string, number>()
  const length =
    addWeighted(frequencies, entry.title, FIELD_WEIGHTS.title) +
    addWeighted(frequencies, entry.path, FIELD_WEIGHTS.path) +
    addWeighted(frequencies, entry.section, FIELD_WEIGHTS.section) +
    addWeighted(frequencies, entry.text, FIELD_WEIGHTS.text)
  return {
    entry,
    frequencies,
    length,
    titleTerms: ` ${tokenize(entry.title).join(' ')} `,
    haystack: [entry.title, entry.path ?? '', entry.text].join(' ').toLowerCase(),
    ...(entry.path ? { apiPath: normalizeApiPath(entry.path) } : {})
  }
}

export function buildSearchIndex(entries: readonly DocEntry[]): SearchIndex {
  const documents = entries.map(indexDocument)
  const documentFrequency = new Map<string, number>()
  for (const document of documents) {
    for (const term of document.frequencies.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }
  const totalLength = documents.reduce((sum, document) => sum + document.length, 0)
  return { documents, documentFrequency, averageLength: documents.length > 0 ? totalLength / documents.length : 0 }
}

function bm25(index: SearchIndex, document: IndexedDocument, terms: readonly string[]): number {
  const count = index.documents.length
  let score = 0
  let matched = 0
  for (const term of terms) {
    const frequency = document.frequencies.get(term)
    if (!frequency) continue
    matched += 1
    const documents = index.documentFrequency.get(term) ?? 0
    const idf = Math.log(1 + (count - documents + 0.5) / (documents + 0.5))
    const normalization = 1 - BM25_B + (BM25_B * document.length) / (index.averageLength || 1)
    score += (idf * frequency * (BM25_K1 + 1)) / (frequency + BM25_K1 * normalization)
  }
  /* Documents covering more of the query outrank ones repeating one term. */
  return matched === 0 ? 0 : score * (0.5 + (0.5 * matched) / terms.length)
}

function endpointQuery(query: string): EndpointTarget | undefined {
  const match = ENDPOINT_QUERY.exec(query)
  if (!match) return undefined
  const [, method, path] = match
  return method ? { method: method.toUpperCase(), path: normalizeApiPath(path) } : { path: normalizeApiPath(path) }
}

/* A query may name a concrete id (`/contacts/abc123`): it still matches the
   documented template, just less strongly than the exact path. */
function pathMatchWeight(documentedPath: string, queriedPath: string): number {
  if (documentedPath === queriedPath) return 1
  const documented = documentedPath.split('/')
  const queried = queriedPath.split('/')
  const templateMatch =
    documented.length === queried.length &&
    documented.every((segment, index) => segment === '{}' || segment === queried[index])
  return templateMatch ? TEMPLATE_MATCH_WEIGHT : 0
}

export function parseEndpointReference(input: string): EndpointTarget | undefined {
  const match = ENDPOINT_REFERENCE.exec(input.trim())
  if (!match) return undefined
  const [, method, path] = match
  return method ? { method: method.toUpperCase(), path: normalizeApiPath(path) } : { path: normalizeApiPath(path) }
}

/* Every documented endpoint for a request line: exact paths win over
   template matches, and a missing method matches all of them. */
export function findEndpoints(index: SearchIndex, target: EndpointTarget): DocEntry[] {
  const matches = index.documents.flatMap(document => {
    if (!document.apiPath || (target.method && target.method !== document.entry.method)) return []
    const weight = pathMatchWeight(document.apiPath, target.path)
    return weight > 0 ? [{ entry: document.entry, weight }] : []
  })
  const best = Math.max(0, ...matches.map(match => match.weight))
  return matches.filter(match => match.weight === best).map(match => match.entry)
}

function endpointBonus(document: IndexedDocument, target: EndpointTarget | undefined): number {
  if (!target || !document.apiPath) return 0
  const methodWeight = target.method && target.method !== document.entry.method ? METHOD_MISMATCH_WEIGHT : 1
  return ENDPOINT_MATCH_BONUS * pathMatchWeight(document.apiPath, target.path) * methodWeight
}

interface QuerySignals {
  terms: readonly string[]
  /* Space-delimited query tokens when the query has several words. */
  phrase?: string
  identifiers: readonly string[]
  endpoint?: EndpointTarget
}

function queryIdentifiers(query: string): string[] {
  return [...new Set((query.match(IDENTIFIER) ?? []).map(identifier => identifier.toLowerCase()))]
}

function scoreDocument(index: SearchIndex, document: IndexedDocument, signals: QuerySignals): number {
  const relevance = bm25(index, document, signals.terms)
  if (relevance === 0 && !signals.endpoint) return 0
  const phraseBoost = signals.phrase && document.titleTerms.includes(signals.phrase) ? TITLE_PHRASE_BOOST : 1
  const exactIdentifiers = signals.identifiers.filter(identifier => document.haystack.includes(identifier)).length
  return relevance * phraseBoost * (1 + IDENTIFIER_BOOST * exactIdentifiers) + endpointBonus(document, signals.endpoint)
}

function pageOf(url: string): string {
  return url.split('#')[0]
}

/* Keeps several sections of one long page from crowding out other pages. */
function diversify(hits: readonly SearchHit[], limit: number, maxPerPage: number): SearchHit[] {
  const perPage = new Map<string, number>()
  const selected: SearchHit[] = []
  for (const hit of hits) {
    const page = pageOf(hit.entry.url)
    const count = perPage.get(page) ?? 0
    if (count >= maxPerPage) continue
    perPage.set(page, count + 1)
    selected.push(hit)
    if (selected.length === limit) break
  }
  return selected
}

export function searchIndex(index: SearchIndex, query: string, options: SearchOptions): SearchOutcome {
  const tokens = tokenize(query)
  const terms = [...new Set(tokens)]
  const endpoint = endpointQuery(query)
  if (terms.length === 0 && !endpoint) return { hits: [], total: 0, terms }

  const signals: QuerySignals = {
    terms,
    /* Multi-word queries whose tokens appear in order in a title rank higher. */
    ...(tokens.length > 1 ? { phrase: ` ${tokens.join(' ')} ` } : {}),
    identifiers: queryIdentifiers(query),
    ...(endpoint ? { endpoint } : {})
  }
  const ranked = index.documents
    .filter(document => !options.kind || document.entry.kind === options.kind)
    .map(document => ({ entry: document.entry, score: scoreDocument(index, document, signals) }))
    .filter(hit => hit.score > 0)
    .sort((left, right) => right.score - left.score)

  return {
    hits: diversify(ranked, options.limit, options.maxPerPage ?? DEFAULT_MAX_PER_PAGE),
    total: ranked.length,
    terms
  }
}
