import path from 'node:path'

import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type JSONPath,
  type ParseError
} from 'jsonc-parser'

import { isRecord } from '../api/response.js'

/* Edits reuse the document's own indentation and line endings. */
export function jsoncFormattingOptions(contents: string): FormattingOptions {
  const indentation = contents.match(/^[\t ]+(?="[^"]+"\s*:)/m)?.[0]
  const insertSpaces = !indentation?.includes('\t')
  return {
    eol: contents.includes('\r\n') ? '\r\n' : '\n',
    insertSpaces,
    tabSize: insertSpaces ? (indentation?.length ?? 2) : 1
  }
}

/* Parses JSON with comments and trailing commas, requiring an object root. */
export function parseJsoncObject(contents: string, file: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const value = parse(contents, errors, { allowTrailingComma: true }) as unknown
  if (errors.length > 0) {
    const first = errors[0]
    throw new Error(`${path.basename(file)} is invalid: ${printParseErrorCode(first.error)} at offset ${first.offset}.`)
  }
  if (!isRecord(value)) throw new Error(`${path.basename(file)} must contain a JSON object.`)
  return value
}

/* Replaces one value in place, so comments and unrelated settings survive. */
export function setJsoncValue(contents: string, jsonPath: JSONPath, value: unknown): string {
  return applyEdits(
    contents,
    modify(contents, jsonPath, value, { formattingOptions: jsoncFormattingOptions(contents) })
  )
}
