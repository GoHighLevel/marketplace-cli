import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  let contents: string
  try {
    contents = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`Cannot read JSON file "${filePath}": ${(error as Error).message}`)
  }
  try {
    return JSON.parse(contents) as T
  } catch (error) {
    throw new Error(`JSON file "${filePath}" contains invalid JSON: ${(error as Error).message}`)
  }
}

/* Atomic writes use a sibling temporary file and apply the caller's
   requested permissions after rename. */
export async function writeJsonFileAtomic(filePath: string, data: unknown, mode = 0o600): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode })
    await fs.rename(tmp, filePath)
    await fs.chmod(filePath, mode)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}
