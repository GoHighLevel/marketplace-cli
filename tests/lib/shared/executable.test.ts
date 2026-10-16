import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { executableCandidates, findExecutable, runExecutable } from '../../../src/lib/shared/executable.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-executable-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function createFile(name: string, mode: number): Promise<string> {
  const file = path.join(dir, name)
  await fs.writeFile(file, '#!/bin/sh\n', { mode })
  return file
}

describe('findExecutable', () => {
  it('returns the first executable file on PATH and skips non-executable files', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-executable-other-'))
    try {
      await createFile('tool', 0o644)
      await fs.writeFile(path.join(other, 'tool'), '#!/bin/sh\n', { mode: 0o755 })
      const env = { PATH: [dir, other].join(path.posix.delimiter) }

      await expect(findExecutable('tool', env, 'darwin')).resolves.toBe(path.join(other, 'tool'))
      await expect(findExecutable('missing', env, 'darwin')).resolves.toBeUndefined()
    } finally {
      await fs.rm(other, { recursive: true, force: true })
    }
  })

  it('returns undefined when PATH is empty', async () => {
    await expect(findExecutable('node', {}, 'linux')).resolves.toBeUndefined()
  })
})

describe('executableCandidates', () => {
  it('tries only PATHEXT extensions on Windows, skipping the extensionless npm shell script', () => {
    expect(executableCandidates('claude', { Path: 'C:\\npm;D:\\bin', PATHEXT: '.EXE;.CMD' }, 'win32')).toEqual([
      'C:\\npm\\claude.exe',
      'C:\\npm\\claude.cmd',
      'D:\\bin\\claude.exe',
      'D:\\bin\\claude.cmd'
    ])
  })

  it('tries the bare name in each PATH directory elsewhere', () => {
    expect(executableCandidates('codex', { PATH: '/usr/local/bin:/opt/bin' }, 'darwin')).toEqual([
      '/usr/local/bin/codex',
      '/opt/bin/codex'
    ])
  })
})

describe('runExecutable', () => {
  it('captures output and the exit code without a shell', async () => {
    const result = await runExecutable(process.execPath, [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'
    ])
    expect(result).toEqual({ exitCode: 3, stdout: 'out', stderr: 'err', timedOut: false })
  })

  it('passes shell metacharacters through literally', async () => {
    const result = await runExecutable(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', '$(id) && ;'])
    expect(result.stdout).toBe('$(id) && ;')
  })

  it('stops a command that exceeds its timeout', async () => {
    const result = await runExecutable(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 100 })
    expect(result.timedOut).toBe(true)
  })

  it('refuses arguments that cmd.exe would expand or split before spawning a Windows shim', async () => {
    await expect(runExecutable('C:\\tools\\claude.cmd', ['%PATH%'], { platform: 'win32' })).rejects.toThrow(
      /Windows command shell/
    )
    await expect(runExecutable('C:\\tools\\claude.cmd', ['a"b'], { platform: 'win32' })).rejects.toThrow(
      /Windows command shell/
    )
  })

  it('rejects when the executable does not exist', async () => {
    await expect(runExecutable(path.join(dir, 'missing'), [])).rejects.toThrow(/ENOENT/)
  })
})
