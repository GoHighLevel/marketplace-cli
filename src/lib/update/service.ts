import { spawn } from 'node:child_process'

export const MARKETPLACE_CLI_LATEST = '@gohighlevel/marketplace-cli@latest'

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'volta'] as const

export type PackageManager = (typeof PACKAGE_MANAGERS)[number]

export interface UpdateInvocation {
  command: string
  args: string[]
}

export function detectPackageManager(
  executablePath: string | undefined,
  userAgent: string | undefined
): PackageManager {
  const normalizedPath = executablePath?.replaceAll('\\', '/').toLowerCase() ?? ''
  if (normalizedPath.includes('/.volta/')) return 'volta'
  if (normalizedPath.includes('/pnpm/')) return 'pnpm'
  if (normalizedPath.includes('/.bun/')) return 'bun'
  if (normalizedPath.includes('/yarn/')) return 'yarn'

  const agent = userAgent?.split('/')[0]?.toLowerCase()
  if (PACKAGE_MANAGERS.includes(agent as PackageManager)) return agent as PackageManager
  return 'npm'
}

export function buildUpdateInvocation(packageManager: PackageManager, platform = process.platform): UpdateInvocation {
  const command = platform === 'win32' ? `${packageManager}.cmd` : packageManager
  const argsByManager: Record<PackageManager, string[]> = {
    npm: ['install', '--global', MARKETPLACE_CLI_LATEST],
    pnpm: ['add', '--global', MARKETPLACE_CLI_LATEST],
    yarn: ['global', 'add', MARKETPLACE_CLI_LATEST],
    bun: ['add', '--global', MARKETPLACE_CLI_LATEST],
    volta: ['install', MARKETPLACE_CLI_LATEST]
  }
  return { command, args: argsByManager[packageManager] }
}

export function formatUpdateInvocation(invocation: UpdateInvocation): string {
  return [invocation.command, ...invocation.args].join(' ')
}

export async function runUpdateInvocation(invocation: UpdateInvocation, silent: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
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

    child.once('error', reject)
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
