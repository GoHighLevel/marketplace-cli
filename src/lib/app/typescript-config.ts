import { promises as fs } from 'node:fs'
import path from 'node:path'

import { writeTextFileAtomic } from '../shared/atomic-file.js'
import { generatedFileHeader, hasGeneratedFileMarker } from '../shared/generated-file.js'
import { parseJsoncObject, setJsoncValue } from '../shared/jsonc.js'

const CONFIG_FILENAMES = ['tsconfig.json', 'jsconfig.json'] as const

export interface TypeScriptConfigResult {
  file: string
  status: 'created' | 'unchanged' | 'updated'
}

export interface TypeScriptConfigOptions {
  exclude?: readonly string[]
}

async function lstatIfPresent(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function configPath(value: string): string {
  return value.split(path.sep).join('/')
}

function normalizedConfigPath(value: string): string {
  return path.posix.normalize(value.replace(/^\.\//, ''))
}

function stringList(value: unknown, property: 'exclude' | 'files' | 'include', file: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`${path.basename(file)}.${property} must be an array of strings.`)
  }
  return value
}

function appendConfigPaths(
  contents: string,
  file: string,
  property: 'exclude' | 'files' | 'include',
  paths: readonly string[]
): string {
  if (paths.length === 0) return contents
  const config = parseJsoncObject(contents, file)
  const existing = Object.hasOwn(config, property) ? stringList(config[property], property, file) : []
  const normalized = new Set(existing.map(normalizedConfigPath))
  const missing = paths.filter(value => !normalized.has(normalizedConfigPath(value)))
  if (missing.length === 0) return contents

  return setJsoncValue(contents, [property], [...existing, ...missing])
}

function updateConfigContents(
  contents: string,
  file: string,
  declarationPath: string,
  options: TypeScriptConfigOptions
): string {
  const config = parseJsoncObject(contents, file)
  const sourceProperty = Object.hasOwn(config, 'files')
    ? 'files'
    : Object.hasOwn(config, 'include')
      ? 'include'
      : undefined
  let updated = sourceProperty ? appendConfigPaths(contents, file, sourceProperty, [declarationPath]) : contents

  /* Explicit files are developer-owned and are not affected by exclude. */
  if (sourceProperty !== 'files') updated = appendConfigPaths(updated, file, 'exclude', options.exclude ?? [])
  return updated
}

function isCliManagedConfig(contents: string, file: string, declarationPath: string): boolean {
  if (hasGeneratedFileMarker(contents)) return true
  const config = parseJsoncObject(contents, file)
  if (Object.keys(config).some(property => property !== 'exclude' && property !== 'include')) return false
  if (!Object.hasOwn(config, 'include')) return false

  const include = stringList(config.include, 'include', file).map(normalizedConfigPath)
  const expected = [declarationPath, 'src/**/*'].map(normalizedConfigPath)
  return include.length === expected.length && expected.every(value => include.includes(value))
}

function withGeneratedHeader(contents: string): string {
  const leadingComment = contents.match(/^\/\*[\s\S]*?\*\/\r?\n?/u)?.[0]
  const configContents =
    leadingComment && hasGeneratedFileMarker(leadingComment) ? contents.slice(leadingComment.length) : contents
  return `${generatedFileHeader()}\n${configContents}`
}

async function findConfigFile(
  directory: string
): Promise<{ file: string; stat?: Awaited<ReturnType<typeof fs.lstat>> }> {
  for (const name of CONFIG_FILENAMES) {
    const file = path.join(directory, name)
    const stat = await lstatIfPresent(file)
    if (stat) return { file, stat }
  }
  return { file: path.join(directory, CONFIG_FILENAMES[0]) }
}

export async function synchronizeTypeScriptConfig(
  directory: string,
  declarationFile: string,
  options: TypeScriptConfigOptions = {}
): Promise<TypeScriptConfigResult> {
  const { file, stat } = await findConfigFile(directory)
  const declarationPath = configPath(path.relative(directory, declarationFile))

  if (!stat) {
    const config = {
      include: [declarationPath, 'src/**/*'],
      ...((options.exclude?.length ?? 0) > 0 ? { exclude: [...(options.exclude ?? [])] } : {})
    }
    const contents = `${generatedFileHeader()}\n${JSON.stringify(config, null, 2)}\n`
    await writeTextFileAtomic(file, contents, 0o644)
    return { file, status: 'created' }
  }

  if (stat.isSymbolicLink()) throw new Error(`${path.basename(file)} cannot be a symbolic link.`)
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a regular file.`)

  const contents = await fs.readFile(file, 'utf8')
  const managed = isCliManagedConfig(contents, file, declarationPath)
  const configContents = updateConfigContents(contents, file, declarationPath, options)
  const updatedContents = managed ? withGeneratedHeader(configContents) : configContents
  if (updatedContents === contents) return { file, status: 'unchanged' }

  await writeTextFileAtomic(file, updatedContents, Number(stat.mode) & 0o777)
  return { file, status: 'updated' }
}
