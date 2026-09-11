/* Narrows an unknown thrown value to a user-facing message. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
