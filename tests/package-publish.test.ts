import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

interface PackageMetadata {
  bin?: Record<string, string>
  files?: string[]
  publishConfig?: Record<string, unknown>
  scripts?: Record<string, string>
}

const ROOT_DIRECTORY = fileURLToPath(new URL('..', import.meta.url))
const PACKAGE_FILE = path.join(ROOT_DIRECTORY, 'package.json')

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async entry => {
      const entryPath = path.join(directory, entry.name)
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
    })
  )
  return files.flat()
}

async function readPackageMetadata(): Promise<PackageMetadata> {
  return JSON.parse(await fs.readFile(PACKAGE_FILE, 'utf8')) as PackageMetadata
}

describe('npm publication contract', () => {
  it('uses the canonical executable path accepted by npm', async () => {
    const metadata = await readPackageMetadata()
    expect(metadata.bin).toEqual({ ghl: 'bin/run.js' })
  })

  it('limits publication to the complete runtime artifact', async () => {
    const metadata = await readPackageMetadata()
    expect(metadata.files).toEqual(['bin', 'dist', 'oclif.manifest.json'])
  })

  it('publishes the scoped package publicly', async () => {
    const metadata = await readPackageMetadata()
    expect(metadata.publishConfig).toEqual({ access: 'public' })
  })

  it('runs the full quality gate before npm publishes', async () => {
    const metadata = await readPackageMetadata()
    expect(metadata.scripts?.prepublishOnly).toBe('npm test && npm run lint')
  })

  it('cleans generated output before compiling', async () => {
    const metadata = await readPackageMetadata()
    expect(metadata.scripts?.build).toBe('npm run clean && tsc')
  })

  it('contains exactly one compiled JavaScript file per TypeScript source file', async () => {
    const sourceDirectory = path.join(ROOT_DIRECTORY, 'src')
    const distributionDirectory = path.join(ROOT_DIRECTORY, 'dist')
    const sourceFiles = (await listFiles(sourceDirectory))
      .filter(file => file.endsWith('.ts'))
      .map(file => path.relative(sourceDirectory, file).replace(/\.ts$/, '.js'))
      .sort()
    const distributionFiles = (await listFiles(distributionDirectory))
      .filter(file => file.endsWith('.js'))
      .map(file => path.relative(distributionDirectory, file))
      .sort()

    expect(distributionFiles).toEqual(sourceFiles)
  })

  it('ships an executable CLI launcher', async () => {
    await expect(fs.access(path.join(ROOT_DIRECTORY, 'bin/run.js'), constants.X_OK)).resolves.toBeUndefined()
  })
})
