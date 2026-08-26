export function normalizeVariadicArgs(values: string[], label: string): string[] {
  const normalized = values.map(value => value.trim())
  const invalid = normalized.find(value => !value || value.startsWith('-'))
  if (invalid !== undefined) {
    throw new Error(
      invalid.startsWith('-')
        ? `Unknown option "${invalid}". If this is a ${label} beginning with a dash, prefix it with "./".`
        : `Empty ${label} values are not allowed.`
    )
  }
  return [...new Set(normalized)]
}
