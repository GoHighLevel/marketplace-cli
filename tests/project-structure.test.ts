import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

interface PackageMetadata {
  bugs?: { url?: string }
  homepage?: string
  name?: string
  repository?: { type?: string; url?: string }
}

const ROOT_DIRECTORY = fileURLToPath(new URL('..', import.meta.url))
const LIBRARY_DIRECTORY = path.join(ROOT_DIRECTORY, 'src/lib')
const LIBRARY_TEST_DIRECTORY = path.join(ROOT_DIRECTORY, 'tests/lib')
const EXPECTED_DOMAINS = [
  'api',
  'app',
  'auth',
  'billing',
  'config',
  'secrets',
  'shared',
  'webhooks',
  'workflows'
]

const DOMAIN_FILENAME_RULES = [
  { directory: 'api', redundantPrefixes: ['api'] },
  { directory: 'app', redundantPrefixes: ['app'] },
  { directory: 'auth', redundantPrefixes: ['auth'] },
  { directory: 'billing', redundantPrefixes: ['billing'] },
  { directory: 'config', redundantPrefixes: ['config'] },
  { directory: 'secrets', redundantPrefixes: ['secret', 'secrets'] },
  { directory: 'webhooks', redundantPrefixes: ['webhook', 'webhooks'] },
  {
    directory: path.join('workflows', 'actions'),
    redundantPrefixes: ['action', 'actions', 'workflow-action', 'workflow-actions']
  },
  {
    directory: path.join('workflows', 'triggers'),
    redundantPrefixes: ['trigger', 'triggers', 'workflow-trigger', 'workflow-triggers']
  },
  {
    directory: path.join('workflows', 'shared'),
    redundantPrefixes: ['workflow', 'workflows']
  }
]

async function directTypeScriptFiles(directory: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => entry.name)
    .sort()
}

async function directDirectories(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

async function allTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(entry => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return allTypeScriptFiles(entryPath)
      return Promise.resolve(entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [])
    })
  )
  return files.flat().sort()
}

async function redundantDomainFilenames(rootDirectory: string): Promise<string[]> {
  const violations: string[] = []
  for (const rule of DOMAIN_FILENAME_RULES) {
    const directory = path.join(rootDirectory, rule.directory)
    const files = await directTypeScriptFiles(directory)
    for (const file of files) {
      const basename = file.replace(/\.test\.ts$|\.ts$/u, '')
      if (rule.redundantPrefixes.some(prefix => basename === prefix || basename.startsWith(`${prefix}-`))) {
        violations.push(path.join(rule.directory, file))
      }
    }
  }
  return violations.sort()
}

describe('project structure', () => {
  it('groups library modules and their tests by domain', async () => {
    expect(await directTypeScriptFiles(LIBRARY_DIRECTORY)).toEqual([])
    expect(await directTypeScriptFiles(LIBRARY_TEST_DIRECTORY)).toEqual([])
    expect(await directDirectories(LIBRARY_DIRECTORY)).toEqual(expect.arrayContaining(EXPECTED_DOMAINS))
    expect(await directDirectories(LIBRARY_TEST_DIRECTORY)).toEqual(expect.arrayContaining(EXPECTED_DOMAINS))
  })

  it('uses directory context instead of repeating domain names in filenames', async () => {
    expect(await redundantDomainFilenames(LIBRARY_DIRECTORY)).toEqual([])
    expect(await redundantDomainFilenames(LIBRARY_TEST_DIRECTORY)).toEqual([])
  })

  it('uses the marketplace CLI package identity everywhere users install it', async () => {
    const metadata = JSON.parse(
      await fs.readFile(path.join(ROOT_DIRECTORY, 'package.json'), 'utf8')
    ) as PackageMetadata
    const readme = await fs.readFile(path.join(ROOT_DIRECTORY, 'README.md'), 'utf8')

    expect(metadata.name).toBe('@gohighlevel/marketplace-cli')
    expect(metadata.homepage).toBe('https://github.com/GoHighLevel/marketplace-cli#readme')
    expect(metadata.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/GoHighLevel/marketplace-cli.git'
    })
    expect(metadata.bugs?.url).toBe('https://github.com/GoHighLevel/marketplace-cli/issues')
    expect(readme).toContain('npm install -g @gohighlevel/marketplace-cli')
    expect(readme).not.toContain(['GoHighLevel', 'ghl-cli'].join('/'))
  })

  it('documents every public source command in the README', async () => {
    const readme = await fs.readFile(path.join(ROOT_DIRECTORY, 'README.md'), 'utf8')
    const commandDirectory = path.join(ROOT_DIRECTORY, 'src/commands')
    const commandNames = (await allTypeScriptFiles(commandDirectory)).map(file => {
      const segments = path.relative(commandDirectory, file).replace(/\.ts$/u, '').split(path.sep)
      if (segments.at(-1) === 'index') segments.pop()
      return segments.join(' ')
    })
    const undocumented = commandNames.filter(command => {
      return !readme.includes(`\`ghl ${command}\``) && !readme.includes(`\`ghl ${command} `)
    })

    expect(undocumented).toEqual([])
  })
})
