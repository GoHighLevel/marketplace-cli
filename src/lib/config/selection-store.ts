import path from 'node:path'

import { isRecord } from '../api/response.js'
import { readJsonFile, writeJsonFileAtomic } from '../shared/json-file.js'
import { validateProfileName } from '../shared/validation.js'

export interface SelectedApp {
  appId: string
  versionId: string
  name?: string
}

interface ConfigFile {
  version: 1
  profiles: Record<string, { selectedApp?: SelectedApp }>
}

function configPath(configDir: string): string {
  return path.join(configDir, 'config.json')
}

function isSelectedApp(value: unknown): value is SelectedApp {
  return (
    isRecord(value) &&
    typeof value.appId === 'string' &&
    value.appId.length > 0 &&
    typeof value.versionId === 'string' &&
    value.versionId.length > 0 &&
    (value.name === undefined || typeof value.name === 'string')
  )
}

async function loadConfigFile(configDir: string): Promise<ConfigFile> {
  const filePath = configPath(configDir)
  const existing = await readJsonFile<unknown>(filePath)
  if (existing === undefined) return { version: 1, profiles: {} }
  const validProfiles =
    isRecord(existing) &&
    isRecord(existing.profiles) &&
    Object.entries(existing.profiles).every(([name, profile]) => {
      if (validateProfileName(name) !== true) return false
      if (!isRecord(profile)) return false
      if (profile.selectedApp === undefined) return true
      return isSelectedApp(profile.selectedApp)
    })
  if (!validProfiles || existing.version !== 1) {
    throw new Error(`Config file "${filePath}" has an invalid structure.`)
  }
  return existing as unknown as ConfigFile
}

export async function getSelectedApp(configDir: string, profile: string): Promise<SelectedApp | undefined> {
  const profileValidation = validateProfileName(profile)
  if (profileValidation !== true) throw new Error(profileValidation)
  const config = await loadConfigFile(configDir)
  return config.profiles[profile]?.selectedApp
}

export async function saveSelectedApp(configDir: string, profile: string, app: SelectedApp): Promise<void> {
  const profileValidation = validateProfileName(profile)
  if (profileValidation !== true) throw new Error(profileValidation)
  if (!isSelectedApp(app)) throw new Error('App selection data has an invalid structure.')
  const config = await loadConfigFile(configDir)
  const next: ConfigFile = {
    ...config,
    profiles: { ...config.profiles, [profile]: { ...config.profiles[profile], selectedApp: app } }
  }
  await writeJsonFileAtomic(configPath(configDir), next)
}

export async function clearSelectedApp(configDir: string, profile: string): Promise<boolean> {
  const profileValidation = validateProfileName(profile)
  if (profileValidation !== true) throw new Error(profileValidation)
  const config = await loadConfigFile(configDir)
  const current = config.profiles[profile]
  if (!current?.selectedApp) return false
  const { selectedApp: _selectedApp, ...profileConfig } = current
  const next: ConfigFile = {
    ...config,
    profiles: { ...config.profiles, [profile]: profileConfig }
  }
  await writeJsonFileAtomic(configPath(configDir), next)
  return true
}
