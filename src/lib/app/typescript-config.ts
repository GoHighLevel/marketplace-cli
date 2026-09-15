import { promises as fs } from 'node:fs'
import path from 'node:path'

import { applyEdits, modify, parse, printParseErrorCode, type FormattingOptions, type ParseError } from 'jsonc-parser'

import { writeTextFileAtomic } from '../shared/atomic-file.js'

const CONFIG_FILENAMES = ['tsconfig.json', 'jsconfig.json'] as const

export interface TypeScriptConfigResult {
  file: string
  status: 'created' | 'unchanged' | 'updated'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function formattingOptions(contents: string): FormattingOptions {
  const indentation = contents.match(/^[\t ]+(?="[^"]+"\s*:)/m)?.[0]
  const insertSpaces = !indentation?.includes('\t')
  return {
    eol: contents.includes('\r\n') ? '\r\n' : '\n',
    insertSpaces,
    tabSize: insertSpaces ? (indentation?.length ?? 2) : 1
  }
}

function parseConfig(contents: string, file: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const value = parse(contents, errors, { allowTrailingComma: true }) as unknown
  if (errors.length > 0) {
    const first = errors[0]
    throw new Error(`${path.basename(file)} is invalid: ${printParseErrorCode(first.error)} at offset ${first.offset}.`)
  }
  if (!isRecord(value)) throw new Error(`${path.basename(file)} must contain a JSON object.`)
  return value
}

function stringList(value: unknown, property: 'files' | 'include', file: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`${path.basename(file)}.${property} must be an array of strings.`)
  }
  return value
}

function updateConfigContents(contents: string, file: string, declarationPath: string): string {
  const config = parseConfig(contents, file)
  const property = Object.hasOwn(config, 'files') ? 'files' : Object.hasOwn(config, 'include') ? 'include' : undefined
  if (!property) return contents

  const existing = stringList(config[property], property, file)

  if (existing.some(value => normalizedConfigPath(value) === normalizedConfigPath(declarationPath))) {
    return contents
  }

  const edits = modify(contents, [property], [...existing, declarationPath], {
    formattingOptions: formattingOptions(contents)
  })
  return applyEdits(contents, edits)
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
  declarationFile: string
): Promise<TypeScriptConfigResult> {
  const { file, stat } = await findConfigFile(directory)
  const declarationPath = configPath(path.relative(directory, declarationFile))

  if (!stat) {
    const contents = `${JSON.stringify({ include: [declarationPath, 'src/**/*'] }, null, 2)}\n`
    await writeTextFileAtomic(file, contents, 0o644)
    return { file, status: 'created' }
  }

  if (stat.isSymbolicLink()) throw new Error(`${path.basename(file)} cannot be a symbolic link.`)
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a regular file.`)

  const contents = await fs.readFile(file, 'utf8')
  const updatedContents = updateConfigContents(contents, file, declarationPath)
  if (updatedContents === contents) return { file, status: 'unchanged' }

  await writeTextFileAtomic(file, updatedContents, Number(stat.mode) & 0o777)
  return { file, status: 'updated' }
}
