import { spawn } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'

import { platformPath } from './platform.js'

export interface ExecutableResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunExecutableOptions {
  platform?: NodeJS.Platform
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_CAPTURED_OUTPUT = 16_384
const WINDOWS_SHELL_SCRIPT = /\.(?:bat|cmd)$/i
const UNSAFE_WINDOWS_SHELL_CHARACTERS = /["%\r\n]/

async function isExecutableFile(candidate: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate)
    if (!stat.isFile()) return false
    if (platform !== 'win32') await fs.access(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/* Every path a command name can resolve to, in PATH order. Windows only
   accepts PATHEXT extensions: npm installs an extensionless POSIX shell
   script next to each `.cmd` shim, and Windows cannot execute that script. */
export function executableCandidates(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const api = platformPath(platform)
  const directories = (env.PATH ?? env.Path ?? '').split(api.delimiter).filter(Boolean)
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  return directories.flatMap(directory =>
    extensions.map(extension => api.join(directory, `${name}${extension.toLowerCase()}`))
  )
}

/* Resolves a command on PATH without spawning it. */
export async function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<string | undefined> {
  for (const candidate of executableCandidates(name, env, platform)) {
    if (await isExecutableFile(candidate, platform)) return candidate
  }
  return undefined
}

/* cmd.exe expands `%VAR%` even inside quotes and has no escape for a literal
   quote, so such arguments are refused rather than escaped. */
function quoteForWindowsShell(value: string): string {
  if (UNSAFE_WINDOWS_SHELL_CHARACTERS.test(value)) {
    throw new Error(`Cannot pass ${JSON.stringify(value)} safely through the Windows command shell.`)
  }
  return `"${value}"`
}

function appendCapped(current: string, chunk: unknown): string {
  return `${current}${String(chunk)}`.slice(-MAX_CAPTURED_OUTPUT)
}

/* Runs a resolved executable without a shell. Windows `.cmd` shims cannot be
   spawned directly (CVE-2024-27980), so only they go through cmd.exe, with
   every argument quoted and validated first. */
export async function runExecutable(
  file: string,
  args: readonly string[],
  options: RunExecutableOptions = {}
): Promise<ExecutableResult> {
  const platform = options.platform ?? process.platform
  const shell = platform === 'win32' && WINDOWS_SHELL_SCRIPT.test(file)
  const command = shell ? quoteForWindowsShell(file) : file
  const commandArgs = shell ? args.map(quoteForWindowsShell) : [...args]

  return new Promise<ExecutableResult>((resolve, reject) => {
    const child = spawn(command, commandArgs, { shell, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    /* Killing a `.cmd` shim stops cmd.exe but not the program it started,
       which would keep the pipes open; destroying them lets `close` fire. */
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      child.stdout.destroy()
      child.stderr.destroy()
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout = appendCapped(stdout, chunk)
    })
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr = appendCapped(stderr, chunk)
    })
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', exitCode => {
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr, timedOut })
    })
  })
}
