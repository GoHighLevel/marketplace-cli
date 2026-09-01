import { promises as fs } from 'node:fs'
import path from 'node:path'

async function lstatIfPresent(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function removeRegularFileIfPresent(filePath: string, label: string): Promise<boolean> {
  const fileStat = await lstatIfPresent(filePath)
  if (!fileStat) return false
  if (fileStat.isSymbolicLink()) throw new Error(`${label} "${filePath}" cannot be a symbolic link.`)
  if (!fileStat.isFile()) throw new Error(`${label} "${filePath}" is not a regular file.`)
  await fs.unlink(filePath)
  return true
}

/* Prune only empty workspace descendants and stop at the workspace root,
   preserving custom files and sibling module directories. */
export async function removeEmptyDirectoryTree(startDirectory: string, workspaceDirectory: string): Promise<void> {
  const boundary = path.resolve(workspaceDirectory)
  let current = path.resolve(startDirectory)
  const relative = path.relative(boundary, current)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Directory "${current}" must be a descendant of workspace "${boundary}".`)
  }

  while (current !== boundary) {
    const directoryStat = await lstatIfPresent(current)
    if (directoryStat) {
      if (directoryStat.isSymbolicLink()) throw new Error(`Workspace directory "${current}" cannot be a symbolic link.`)
      if (!directoryStat.isDirectory()) throw new Error(`Workspace path "${current}" is not a directory.`)
      try {
        await fs.rmdir(current)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOTEMPTY' || code === 'EEXIST') return
        if (code !== 'ENOENT') throw error
      }
    }
    current = path.dirname(current)
  }
}
