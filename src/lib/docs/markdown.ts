export interface MarkdownHeading {
  level: number
  text: string
  anchor: string
  line: number
}

export interface TextSlice {
  content: string
  startIndex: number
  endIndex: number
  totalLength: number
  nextStartIndex?: number
}

const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/* Bounded so text with many unclosed `[` or `<` stays linear. */
const IMAGE = /!\[([^\]\n]{0,500})\]\([^)\n]{0,2000}\)/g
const LINK = /\[([^\]\n]{0,500})\]\([^)\n]{0,2000}\)/g
const HTML_TAG = /<[^<>\n]{1,500}>/g
const LINE_BREAK_LOOKBACK = 2_000

export function slugifyHeading(text: string): string {
  return text
    .replace(LINK, '$1')
    .replace(HTML_TAG, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function headingText(text: string): string {
  return text.replace(LINK, '$1').replace(/[*_`]/g, '').trim()
}

/* Headings outside fenced code blocks. Repeated headings get `-1`, `-2`
   suffixes so every anchor addresses exactly one section. */
export function findHeadings(lines: readonly string[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  const seen = new Map<string, number>()
  let fence: string | undefined

  lines.forEach((line, index) => {
    const fenceMarker = FENCE.exec(line)?.[1]
    if (fenceMarker) {
      if (!fence) fence = fenceMarker
      else if (fenceMarker[0] === fence[0] && fenceMarker.length >= fence.length) fence = undefined
      return
    }
    if (fence) return

    const match = HEADING.exec(line)
    if (!match) return
    const text = headingText(match[2])
    const slug = slugifyHeading(text)
    const occurrence = seen.get(slug) ?? 0
    seen.set(slug, occurrence + 1)
    headings.push({
      level: match[1].length,
      text,
      anchor: occurrence === 0 ? slug : `${slug}-${occurrence}`,
      line: index
    })
  })
  return headings
}

interface ParsedMarkdown {
  lines: string[]
  headings: MarkdownHeading[]
}

function parseMarkdown(markdown: string): ParsedMarkdown {
  const lines = markdown.split(/\r?\n/)
  return { lines, headings: findHeadings(lines) }
}

/* A heading's section runs to the next heading of the same or a higher level,
   so it includes its subsections. */
function sectionLines({ lines, headings }: ParsedMarkdown, index: number): string[] {
  const start = headings[index]
  const end = headings.slice(index + 1).find(heading => heading.level <= start.level)
  return lines.slice(start.line, end?.line ?? lines.length)
}

/* Returns the section with this anchor, or undefined when no heading has it. */
export function extractSection(markdown: string, anchor: string): string | undefined {
  const parsed = parseMarkdown(markdown)
  const index = parsed.headings.findIndex(heading => heading.anchor === anchor)
  return index === -1 ? undefined : sectionLines(parsed, index).join('\n').trim()
}

/* Returns the first section at `level` with a line that satisfies `matches`. */
export function extractSectionContaining(
  markdown: string,
  level: number,
  matches: (line: string) => boolean
): string | undefined {
  const parsed = parseMarkdown(markdown)
  for (const [index, heading] of parsed.headings.entries()) {
    if (heading.level !== level) continue
    const section = sectionLines(parsed, index)
    if (section.some(matches)) return section.join('\n').trim()
  }
  return undefined
}

/* Anchors of a page's top-level (`##`) sections, in page order. Fetching
   one returns its subsections too, so this short list covers the page. */
/* A page's top-level sections: its `##` headings, or its `###` headings when
   everything sits under one `##` chapter, as in a command reference. */
export function sectionAnchors(markdown: string): string[] {
  const headings = parseMarkdown(markdown).headings
  const atLevel = (level: number) => headings.filter(heading => heading.level === level)
  const sections = atLevel(2).length >= 2 ? atLevel(2) : atLevel(3).length >= 2 ? atLevel(3) : atLevel(2)
  return sections.map(heading => heading.anchor)
}

/* Strips Markdown syntax but keeps code readable: `->`, `=>`, and
   snake_case identifiers survive. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/^ {0,3}(?:`{3,}|~{3,}).*$/gm, ' ')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, ' ')
    .replace(/^\s*>+/gm, ' ')
    .replace(/\*\*|__|[*`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nextWordStart(text: string, index: number): number {
  if (index === 0) return 0
  const space = text.indexOf(' ', index)
  return space === -1 ? index : space + 1
}

function previousWordEnd(text: string, index: number, floor: number): number {
  if (index >= text.length) return text.length
  const space = text.lastIndexOf(' ', index)
  return space > floor ? space : index
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* Search terms are stemmed (`policy`), so they are matched as word prefixes
   of the original text (`policies`), never inside another word. */
function termPosition(text: string, term: string): number {
  const stem = term.endsWith('y') ? term.slice(0, -1) : term
  return text.search(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(stem)}`, 'iu'))
}

/* A window of plain text around the first occurrence of any search term. */
export function excerptAround(text: string, terms: readonly string[], maxLength = 280): string {
  const positions = terms.map(term => termPosition(text, term)).filter(position => position >= 0)
  const first = positions.length > 0 ? Math.min(...positions) : 0
  const start = nextWordStart(text, Math.max(0, first - Math.floor(maxLength / 4)))
  const end = previousWordEnd(text, start + maxLength, start)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/* Pages long documents at a line break near the limit so a continuation
   never starts mid-line. */
export function sliceText(text: string, startIndex: number, maxLength: number): TextSlice {
  const start = Math.min(Math.max(0, startIndex), text.length)
  const limit = Math.min(text.length, start + maxLength)
  const lineBreak = limit < text.length ? text.lastIndexOf('\n', limit - 1) : -1
  const cut = lineBreak > Math.max(start, limit - LINE_BREAK_LOOKBACK) ? lineBreak + 1 : limit
  /* Never split a UTF-16 surrogate pair across two pages. */
  const end = cut < text.length && cut > start && /[\uD800-\uDBFF]/.test(text[cut - 1]) ? cut - 1 : cut
  return {
    content: text.slice(start, end),
    startIndex: start,
    endIndex: end,
    totalLength: text.length,
    ...(end < text.length ? { nextStartIndex: end } : {})
  }
}
