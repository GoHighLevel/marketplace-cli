export const EXTERNAL_AUTH_GUIDE_FILENAME = 'HIGHLEVEL_EXTERNAL_AUTH.md'

export function buildExternalAuthGuide(): string {
  return `# HighLevel External Authentication

Edit \`config.json\`, validate it, inspect the diff, push it, and test the saved portal configuration:

\`\`\`sh
ghl app external-auth validate
ghl app external-auth diff
ghl app external-auth push
ghl app external-auth test --input-file ./external-auth-test.json
\`\`\`

The manifest covers the portal's three-step flow: authentication type selection, complete Basic or OAuth 2 configuration, and a live authentication test. Keep \`basic\` only for \`type: "basic"\` and \`oauth2\` only for \`type: "oauth2"\`.

## Secrets

Never put credentials in this file. OAuth client IDs and client secrets must also use \`\${env:NAME}\` for a value supplied at push time, or \`\${remote}\` to preserve the current portal value. Pull replaces credential and secret-bearing values with \`\${remote}\`; neither this file nor \`.ghl/external-auth-state.json\` stores decrypted credentials.

## Requests and templates

Every request has \`url\`, \`method\`, \`urlParams\`, \`headers\`, and \`body\`. URLs must target public HTTP(S) hosts. Supported provider templates include \`{{userData.fieldKey}}\`, \`{{externalApp.*}}\`, and \`{{bundle.*}}\`. Every \`userData\` reference must match a configured field.

Basic authentication supports up to three installation fields and optional Who Am I account mapping. OAuth 2 supports authorization, access-token, refresh-token, long-lived-token, test, user-info, PKCE, scopes, multi-auth, and Code Mode configuration. A Code Mode step with \`enabled: true\` replaces its corresponding form request.

The \`updateAllRefreshTokens\` option matches the portal's internal-only refresh-token sharing control. The API permits enabling it only for authorized HighLevel internal developer accounts.

## Conflict safety

Pull before editing. Push performs a three-way comparison against the private baseline and current portal state. It stops on overlapping portal edits and only changes draft versions. Published capability locks for Who Am I and multi-auth are enforced locally before any update.
`
}
