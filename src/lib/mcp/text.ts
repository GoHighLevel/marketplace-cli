import { sanitizeTerminalText } from '../api/response.js'

/* Portal and file values are untrusted: each prints as one bounded line, so
   a value cannot inject new lines or instructions into a tool result. */
export function oneLine(value: string | number | undefined | null, maxLength = 200): string {
  return value === undefined || value === null ? '' : sanitizeTerminalText(String(value), maxLength)
}
