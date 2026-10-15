/* Maps backend readiness fields to the CLI command that fixes them. */
export const READINESS_FIX_HINTS: Readonly<Record<string, string>> = {
  name: 'ghl app basic-info --name',
  tagline: 'ghl app basic-info --tagline',
  userTypes: 'ghl app listing --target',
  logo: 'ghl app media upload <file> --logo',
  supportDetails: 'ghl app support --email',
  category: 'ghl app basic-info --category',
  description: 'ghl app profiles --description',
  previewImages: 'ghl app media upload <3+ files>',
  subAccountDescription: 'ghl app profiles --sub-description',
  subAccountPreviewImages: 'ghl app media upload <3+ files> --profile sub-account',
  scopes: 'ghl app scopes add <scope...>',
  redirectUri: 'ghl app redirect add <url>',
  clientKeys: 'ghl app keys create <name>',
  mcpUrl: 'not configurable in this CLI yet; use the developer portal',
  externalAuth: 'not configurable in this CLI yet; use the developer portal',
  externalAuthConfig: 'not configurable in this CLI yet; use the developer portal'
}

export function publishReadinessSymbol(satisfied: boolean): '[✓]' | '[x]' {
  return satisfied ? '[✓]' : '[x]'
}
