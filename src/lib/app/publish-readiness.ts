export function publishReadinessSymbol(satisfied: boolean): '[✓]' | '[x]' {
  return satisfied ? '[✓]' : '[x]'
}
