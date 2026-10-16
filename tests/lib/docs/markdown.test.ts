import { describe, expect, it } from 'vitest'

import {
  excerptAround,
  extractSection,
  extractSectionContaining,
  findHeadings,
  sectionAnchors,
  sliceText,
  slugifyHeading,
  toPlainText
} from '../../../src/lib/docs/markdown.js'

const PAGE = [
  '# Webhooks',
  'Intro.',
  '## Signature verification',
  'Verify first.',
  '```js',
  '# not a heading',
  '```',
  '### Node.js example',
  'Example body.',
  '## Example',
  'First example.',
  '## Example',
  'Second example.'
].join('\n')

describe('markdown headings', () => {
  it('slugifies like common docs renderers', () => {
    expect(slugifyHeading('**Scopes** & [OAuth](https://x) 2.0')).toBe('scopes-oauth-20')
    expect(slugifyHeading('Multi-Account Support & User Info')).toBe('multi-account-support-user-info')
  })

  it('ignores fenced code and gives repeated headings unique anchors', () => {
    expect(findHeadings(PAGE.split('\n')).map(heading => [heading.level, heading.anchor])).toEqual([
      [1, 'webhooks'],
      [2, 'signature-verification'],
      [3, 'nodejs-example'],
      [2, 'example'],
      [2, 'example-1']
    ])
  })

  it('extracts a section through its subsections up to the next sibling', () => {
    expect(extractSection(PAGE, 'signature-verification')).toBe(
      '## Signature verification\nVerify first.\n```js\n# not a heading\n```\n### Node.js example\nExample body.'
    )
    expect(extractSection(PAGE, 'example-1')).toBe('## Example\nSecond example.')
    expect(extractSection(PAGE, 'missing')).toBeUndefined()
  })

  it('finds the section at a level whose lines match, and lists top-level section anchors', () => {
    expect(extractSectionContaining(PAGE, 2, line => line === 'Second example.')).toBe('## Example\nSecond example.')
    expect(extractSectionContaining(PAGE, 3, line => line === 'Second example.')).toBeUndefined()
    expect(sectionAnchors(PAGE)).toEqual(['signature-verification', 'example', 'example-1'])
    expect(sectionAnchors('## Reference\n### Login\na\n### Apps\nb')).toEqual(['login', 'apps'])
    expect(sectionAnchors('## Only\n### One\na')).toEqual(['only'])
  })
})

describe('plain text and excerpts', () => {
  it('strips Markdown syntax but keeps readable text', () => {
    expect(toPlainText('## Title\n**Bold** [link](https://x) `code`\n| a | b |\n|---|---|')).toBe(
      'Title Bold link code a b'
    )
  })

  it('keeps code arrows and snake_case identifiers intact', () => {
    expect(toPlainText('> Note\n`$request->getBody()` uses WEBHOOK_PUBLIC_KEY and (a) => a')).toBe(
      'Note $request->getBody() uses WEBHOOK_PUBLIC_KEY and (a) => a'
    )
  })

  it('centers an excerpt on the first matching term at word boundaries', () => {
    const text = `${'lead '.repeat(100)}the webhook signature header ${'tail '.repeat(100)}`.trim()
    const excerpt = excerptAround(text, ['signature'], 80)
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt).toContain('signature')
    expect(excerpt.length).toBeLessThanOrEqual(82)
    expect(excerptAround('short text', ['missing'])).toBe('short text')
  })

  it('matches stemmed terms as word prefixes, never inside other words', () => {
    const text = `${'lead '.repeat(60)}a provider with refund policies ${'tail '.repeat(60)}`.trim()
    expect(excerptAround(text, ['policy'], 60)).toContain('policies')
    expect(excerptAround(`provider ${'x '.repeat(100)}the id field`, ['id'], 40)).toContain('the id field')
  })
})

describe('sliceText', () => {
  it('returns the whole text when it fits', () => {
    expect(sliceText('abc', 0, 10)).toEqual({ content: 'abc', startIndex: 0, endIndex: 3, totalLength: 3 })
  })

  it('cuts at the last line break before the limit and reports where to continue', () => {
    const text = 'line one\nline two\nline three'
    const first = sliceText(text, 0, 15)
    expect(first).toMatchObject({ content: 'line one\n', nextStartIndex: 9 })
    expect(sliceText(text, first.nextStartIndex ?? 0, 100)).toMatchObject({
      content: 'line two\nline three',
      startIndex: 9
    })
  })

  it('never exceeds maxLength when a line break sits exactly at the limit', () => {
    expect(sliceText('aaaa\nbbbb', 0, 4)).toMatchObject({ content: 'aaaa', endIndex: 4, nextStartIndex: 4 })
  })

  it('does not split a surrogate pair across pages', () => {
    const slice = sliceText('ab😀cd', 0, 3)
    expect(slice).toMatchObject({ content: 'ab', nextStartIndex: 2 })
  })

  it('clamps out-of-range offsets', () => {
    expect(sliceText('abc', 50, 10)).toEqual({ content: '', startIndex: 3, endIndex: 3, totalLength: 3 })
  })
})
