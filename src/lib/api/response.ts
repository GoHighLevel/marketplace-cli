export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/* eslint-disable no-control-regex -- ANSI sequences and control characters are stripped on purpose. */
export function sanitizeTerminalText(value: string, maxLength = 500): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}
/* eslint-enable no-control-regex */

export function extractApiErrorMessage(text: string, statusText = ''): string {
  const trimmed = text.trim()
  if (trimmed) {
    try {
      const body: unknown = JSON.parse(trimmed)
      if (isRecord(body)) {
        const message = body.message ?? body.error ?? body.err
        if (Array.isArray(message)) {
          const messages = message.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          if (messages.length > 0) return sanitizeTerminalText(messages.join('; '))
        }
        if (typeof message === 'string' && message.trim()) return sanitizeTerminalText(message)
      }
    } catch {
      if (!/^\s*</.test(trimmed)) return sanitizeTerminalText(trimmed)
    }
  }
  return sanitizeTerminalText(statusText) || 'Request failed'
}

interface ResponseOptions {
  failureLabel: string
  responseLabel: string
}

export async function readApiResponse(response: Response, options: ResponseOptions): Promise<unknown | undefined> {
  let text = ''
  try {
    text = await response.text()
  } catch {
    if (response.ok) throw new Error(`${options.responseLabel} response could not be read (${response.status}).`)
  }
  if (!response.ok) {
    throw new Error(
      `${options.failureLabel} (${response.status}): ${extractApiErrorMessage(text, response.statusText)}`
    )
  }
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${options.responseLabel} returned invalid JSON (${response.status}).`)
  }
}
