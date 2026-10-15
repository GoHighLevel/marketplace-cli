import { describe, expect, it } from 'vitest'

import {
  allocateBudget,
  compactEndpointSection,
  mergeOutlines,
  selectPageContent,
  toDocPage,
  WHOLE_PAGE_LIMIT
} from '../../../src/lib/docs/pages.js'
import { CONTACTS_REFERENCE, DOCS } from '../../helpers/docs-fetch.js'

const URL = `${DOCS}/guide.md`
const filler = 'x'.repeat(WHOLE_PAGE_LIMIT)
const LARGE_PAGE = `# Guide\n\n## Setup\n\nInstall it.\n\n## Usage\n\nCall it.\n\n## Appendix\n\n${filler}\n`

describe('selectPageContent', () => {
  it('returns a small page whole, even for an anchored URL', () => {
    const page = '# Small\n\n## Part\n\nText.'
    expect(selectPageContent({ url: URL, anchor: 'part' }, page)).toEqual({ url: URL, text: page, page })
  })

  it('returns only the anchored section of a large page', () => {
    expect(selectPageContent({ url: URL, anchor: 'usage' }, LARGE_PAGE)).toEqual({
      url: `${URL}#usage`,
      text: '## Usage\n\nCall it.',
      page: LARGE_PAGE
    })
  })

  it('falls back to the page with a note when a large page lost the anchor', () => {
    expect(selectPageContent({ url: URL, anchor: 'gone' }, LARGE_PAGE)).toMatchObject({
      url: URL,
      text: LARGE_PAGE,
      note: 'Section #gone was not found; showing the page.'
    })
  })
})

describe('compactEndpointSection', () => {
  it('finds the endpoint by its Markdown link and never by a URL that only shares a prefix', () => {
    expect(compactEndpointSection(CONTACTS_REFERENCE, `${DOCS}/ghl/contacts/create-contact.md`)).toMatch(
      /^### Create Contact\nPOST \/contacts\/[\s\S]*contacts\.write$/
    )
    expect(compactEndpointSection(CONTACTS_REFERENCE, `${DOCS}/ghl/contacts/get-contact`)).toBeUndefined()
    expect(compactEndpointSection(CONTACTS_REFERENCE, `${DOCS}/ghl/contacts/missing.md`)).toBeUndefined()
  })
})

describe('allocateBudget', () => {
  it('returns short documents whole and splits the rest evenly', () => {
    expect(allocateBudget([100, 10_000, 10_000], 6_100)).toEqual([100, 3_000, 3_000])
    expect(allocateBudget([500, 800], 10_000)).toEqual([500, 800])
    expect(allocateBudget([], 1_000)).toEqual([])
  })
})

describe('toDocPage', () => {
  it('lists other top-level sections only when part of the page is returned', () => {
    const section = selectPageContent({ url: URL, anchor: 'usage' }, LARGE_PAGE)
    expect(toDocPage(section, 0, 30_000)).toMatchObject({ url: `${URL}#usage`, outline: ['setup', 'appendix'] })

    const whole = selectPageContent({ url: URL }, '# Small\n\n## Part\n\nText.')
    expect(toDocPage(whole, 0, 30_000)).not.toHaveProperty('outline')
  })

  it('lists sections for a truncated page and gives no outline to compact references', () => {
    expect(toDocPage({ url: URL, text: LARGE_PAGE, page: LARGE_PAGE }, 0, 2_000)).toMatchObject({
      nextStartIndex: expect.any(Number),
      outline: ['setup', 'usage', 'appendix']
    })
    expect(toDocPage({ url: URL, text: 'x'.repeat(5_000) }, 0, 2_000)).not.toHaveProperty('outline')
  })
})

describe('mergeOutlines', () => {
  it('lists a page outline once, after its last section, without sections already shown', () => {
    const pages = [
      { url: `${URL}#setup`, content: 'a', startIndex: 0, endIndex: 1, totalLength: 1, outline: ['usage', 'appendix'] },
      { url: `${DOCS}/other.md`, content: 'b', startIndex: 0, endIndex: 1, totalLength: 1 },
      { url: `${URL}#usage`, content: 'c', startIndex: 0, endIndex: 1, totalLength: 1, outline: ['setup', 'appendix'] }
    ]
    const merged = mergeOutlines(pages)
    expect(merged[0]).not.toHaveProperty('outline')
    expect(merged[1]).not.toHaveProperty('outline')
    expect(merged[2].outline).toEqual(['appendix'])
  })
})
