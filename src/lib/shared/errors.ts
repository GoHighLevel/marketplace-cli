/* Narrows an unknown thrown value to a user-facing message. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/* A failure with a stable machine-readable code for automation and agent
   clients; the message stays user-facing. */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'CodedError'
  }
}

/* `CODE: message`, the shape agents read failures in. */
export function codedErrorText(error: unknown, fallbackCode: string): string {
  const code = error instanceof CodedError ? error.code : fallbackCode
  return `${code}: ${errorMessage(error, 'The operation failed.')}`
}
