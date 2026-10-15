import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { AppVersion } from '../../src/lib/api/types.js'
import { initializeAppWorkspace } from '../../src/lib/app/workspace-create.js'
import { completeAppVersion } from './app-files.js'

/* A workspace exactly as `ghl app create` leaves it, for app-1 / version-1. */
export async function writeTestWorkspace(
  directory: string,
  version: AppVersion = completeAppVersion()
): Promise<string> {
  await fs.mkdir(path.dirname(directory), { recursive: true })
  await initializeAppWorkspace(directory, version)
  return directory
}

export async function editJson(file: string, edit: (value: Record<string, any>) => void): Promise<void> {
  const value = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>
  edit(value)
  await fs.writeFile(file, JSON.stringify(value, null, 2))
}

export function appManifest(directory: string): string {
  return path.join(directory, 'ghl-app.json')
}
