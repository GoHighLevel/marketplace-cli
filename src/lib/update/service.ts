import { spawn } from 'node:child_process'

export const MARKETPLACE_CLI_LATEST = '@gohighlevel/marketplace-cli@latest'

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'volta'] as const

export type PackageManager = (typeof PACKAGE_MANAGERS)[number]

export interface UpdateInvocation {
  command: string
  args: string[]
  /* Windows package managers are `.cmd` shims, which Node refuses to spawn
     without a shell (CVE-2024-27980). Every argument is a fixed constant, so
     nothing user-controlled reaches the shell. */
  shell: boolean
}

const INSTALL_PATH_MARKERS: ReadonlyArray<readonly [marker: string, packageManager: PackageManager]> = [
  ['/.volta/', 'volta'],
  ['/pnpm/', 'pnpm'],
  ['/.bun/', 'bun'],
  ['/.yarn/', 'yarn'],
  ['/yarn/', 'yarn']
]

/* Yarn 2+ removed `yarn global`, so only Yarn Classic can own a global install. */
function packageManagerFromUserAgent(userAgent: string | undefined): PackageManager | undefined {
  const [agent, version] = userAgent?.split(' ')[0]?.split('/') ?? []
  const name = agent?.toLowerCase()
  if (!PACKAGE_MANAGERS.includes(name as PackageManager)) return undefined
  if (name === 'yarn' && !/^1\./.test(version ?? '')) return undefined
  return name as PackageManager
}

/* The executable path is the shim the user invoked, which npm and Yarn keep
   outside their package trees, while the install root is the resolved package
   directory. Checking both recognizes every global layout without following
   symbolic links. */
export function detectPackageManager(
  installPaths: ReadonlyArray<string | undefined>,
  userAgent: string | undefined
): PackageManager {
  for (const installPath of installPaths) {
    const normalizedPath = installPath?.replaceAll('\\', '/').toLowerCase() ?? ''
    const match = INSTALL_PATH_MARKERS.find(([marker]) => normalizedPath.includes(marker))
    if (match) return match[1]
  }
  return packageManagerFromUserAgent(userAgent) ?? 'npm'
}

export function buildUpdateInvocation(packageManager: PackageManager, platform = process.platform): UpdateInvocation {
  const argsByManager: Record<PackageManager, string[]> = {
    npm: ['install', '--global', MARKETPLACE_CLI_LATEST],
    pnpm: ['add', '--global', MARKETPLACE_CLI_LATEST],
    yarn: ['global', 'add', MARKETPLACE_CLI_LATEST],
    bun: ['add', '--global', MARKETPLACE_CLI_LATEST],
    volta: ['install', MARKETPLACE_CLI_LATEST]
  }
  return { command: packageManager, args: argsByManager[packageManager], shell: platform === 'win32' }
}

export function formatUpdateInvocation(invocation: UpdateInvocation): string {
  return [invocation.command, ...invocation.args].join(' ')
}

export async function runUpdateInvocation(invocation: UpdateInvocation, silent: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      shell: invocation.shell,
      stdio: silent ? ['ignore', 'ignore', 'pipe'] : 'inherit',
      windowsHide: true
    })
    let stderr = ''

    if (silent) {
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', chunk => {
        stderr = `${stderr}${String(chunk)}`.slice(-16_384)
      })
    }

    child.once('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`Package manager "${invocation.command}" was not found on PATH.`))
        return
      }
      reject(error)
    })
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      const detail = stderr.trim() || (signal ? `terminated by ${signal}` : `exited with code ${code ?? 'unknown'}`)
      reject(new Error(`Package manager failed: ${detail}`))
    })
  })
}
