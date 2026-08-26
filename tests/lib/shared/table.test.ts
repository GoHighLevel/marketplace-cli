import { describe, expect, it } from 'vitest'

import { renderTable } from '../../../src/lib/shared/table.js'

describe('renderTable', () => {
  it('aligns columns to the widest cell', () => {
    const output = renderTable(
      ['NAME', 'ID'],
      [
        ['My App', '1'],
        ['X', '12345']
      ]
    )
    expect(output.split('\n')).toEqual(['NAME    ID   ', 'My App  1    ', 'X       12345'])
  })

  it('handles missing cells', () => {
    expect(() => renderTable(['A', 'B'], [['only-a']])).not.toThrow()
  })

  it('keeps untrusted values on one line and strips terminal control sequences', () => {
    expect(renderTable(['NAME'], [['\u001b[31mBad\u001b[0m\nName']])).toContain('Bad Name')
    expect(renderTable(['NAME'], [['\u001b[31mBad\u001b[0m\nName']])).not.toContain('\u001b')
  })
})
