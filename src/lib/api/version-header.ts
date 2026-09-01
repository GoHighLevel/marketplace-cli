import { createRequire } from 'node:module'

/* This spelling is the public API contract requested for CLI request tracing. */
export const CLI_VERSION_HEADER = 'ghl-cli-verision'

function loadCliVersion(): string {
  const metadata = createRequire(import.meta.url)('../../../package.json') as unknown
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string' ||
    !metadata.version.trim()
  ) {
    throw new Error('CLI package metadata does not contain a valid version.')
  }
  return metadata.version
}

export const CLI_VERSION = loadCliVersion()
export const CLI_VERSION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  [CLI_VERSION_HEADER]: CLI_VERSION
})
