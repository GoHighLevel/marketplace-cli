import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'

export async function writeTextFileAtomic(filePath: string, contents: string, mode = 0o644): Promise<void> {
  const temporaryFile = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await fs.writeFile(temporaryFile, contents, { encoding: 'utf8', mode, flag: 'wx' })
    await fs.rename(temporaryFile, filePath)
    await fs.chmod(filePath, mode)
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => undefined)
    throw error
  }
}
