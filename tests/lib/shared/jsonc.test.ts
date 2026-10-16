import { describe, expect, it } from 'vitest'

import { jsoncFormattingOptions, parseJsoncObject, setJsoncValue } from '../../../src/lib/shared/jsonc.js'

describe('JSONC documents', () => {
  it('detects tab indentation and CRLF line endings', () => {
    expect(jsoncFormattingOptions('{\r\n\t"a": 1\r\n}')).toEqual({ eol: '\r\n', insertSpaces: false, tabSize: 1 })
    expect(jsoncFormattingOptions('{\n    "a": 1\n}')).toEqual({ eol: '\n', insertSpaces: true, tabSize: 4 })
    expect(jsoncFormattingOptions('{}')).toEqual({ eol: '\n', insertSpaces: true, tabSize: 2 })
  })

  it('parses comments and trailing commas but rejects invalid or non-object roots', () => {
    expect(parseJsoncObject('{\n  // note\n  "a": 1,\n}', 'mcp.json')).toEqual({ a: 1 })
    expect(() => parseJsoncObject('{"a": ', 'mcp.json')).toThrow(/mcp\.json is invalid/)
    expect(() => parseJsoncObject('[]', 'mcp.json')).toThrow(/mcp\.json must contain a JSON object/)
  })

  it('sets a nested value while preserving comments, values, order, and indentation style', () => {
    const original = '{\n\t// keep me\n\t"servers": {\n\t\t"other": { "url": "x" }\n\t},\n\t"inputs": []\n}\n'
    const updated = setJsoncValue(original, ['servers', 'new'], { command: 'node' })

    expect(updated.startsWith('{\n\t// keep me\n\t"servers": {\n')).toBe(true)
    expect(updated).toContain('\t\t"new": {\n\t\t\t"command": "node"\n\t\t}')
    expect(updated.endsWith('\t"inputs": []\n}\n')).toBe(true)
    expect(parseJsoncObject(updated, 'mcp.json')).toEqual({
      servers: { other: { url: 'x' }, new: { command: 'node' } },
      inputs: []
    })
  })

  it('creates missing parent objects in an empty document', () => {
    const updated = setJsoncValue('{}\n', ['mcpServers', 'name'], { args: ['a'] })
    expect(parseJsoncObject(updated, 'mcp.json')).toEqual({ mcpServers: { name: { args: ['a'] } } })
  })
})
