import { platformPath } from '../shared/platform.js'
import type { McpLaunchCommand } from './clients.js'

export interface LaunchOptions {
  /* Root directory of the running CLI package. */
  root: string
  /* Absolute path of the Node.js binary running the CLI. */
  execPath: string
  platform: NodeJS.Platform
  standalone: boolean
  packageName: string
  binName: string
  version: string
  /* npm registry that standalone launches install from. */
  registry: string
}

const START_ARGS = ['mcp', 'start']
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
/* Package-runner caches are deleted or rotated, so they cannot host a
   long-lived client registration. */
const EPHEMERAL_INSTALL_MARKERS = ['/_npx/', '/pnpm/dlx/', '/bunx-', '/yarn/berry/cache/']

export function isEphemeralInstall(root: string): boolean {
  const normalized = `${root.replaceAll('\\', '/')}/`
  return EPHEMERAL_INSTALL_MARKERS.some(marker => normalized.includes(marker))
}

/* Standalone launches pin their registry: clients start servers inside the
   open project, where a repository's own .npmrc could otherwise redirect npx
   to a registry serving a different package under this package's name. */
export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org/'

export function validateRegistry(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`--registry must be an https URL, got "${value}".`)
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`--registry must be an https URL without credentials, got "${value}".`)
  }
  return url.href
}

export function validateCliVersion(value: string): string {
  const version = value.trim()
  if (version === 'latest' || SEMVER.test(version)) return version
  throw new Error(`--cli-version must be "latest" or an exact version such as 1.2.3, got "${value}".`)
}

/* A local install launches with absolute paths: editors started from a dock
   or launcher do not inherit the shell PATH that nvm, volta, or asdf set up,
   so neither `ghl` nor `node` would resolve there. */
export function buildLaunchCommand(options: LaunchOptions): McpLaunchCommand {
  if (!options.standalone) {
    const runScript = platformPath(options.platform).join(options.root, 'bin', 'run.js')
    return { command: options.execPath, args: [runScript, ...START_ARGS] }
  }

  const npxArgs = [
    '-y',
    `--registry=${options.registry}`,
    '--package',
    `${options.packageName}@${options.version}`,
    options.binName,
    ...START_ARGS
  ]
  /* Clients spawn without a shell, and npx is a `.cmd` shim on Windows. */
  return options.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', ...npxArgs] }
    : { command: 'npx', args: npxArgs }
}

export function formatLaunchCommand(launch: McpLaunchCommand): string {
  return [launch.command, ...launch.args].map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')
}
