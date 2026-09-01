import type { DeveloperTeam } from '../api/client.js'
import { clearSelectedApp, getSelectedApp, saveSelectedApp } from '../config/selection-store.js'

interface DeveloperAccountClient {
  activeProfileName: string
  activeTeamId?: string
  selectDeveloperTeam(teamId: string, memberships?: DeveloperTeam[]): Promise<DeveloperTeam>
}

export function developerAccountName(account: DeveloperTeam): string {
  const name = account.name?.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (name) return name.slice(0, 200)
  return account.role?.toUpperCase() === 'OWNER' ? 'Your Team' : 'Unnamed account'
}

export function developerAccountSummary(account: DeveloperTeam): string {
  return `${developerAccountName(account)} (${account.team})`
}

export function developerAccountChoice(account: DeveloperTeam, activeTeamId?: string): string {
  const role = account.role?.trim() || 'member'
  const activeMarker = account.team === activeTeamId ? ' — active' : ''
  return `${developerAccountName(account)} (${account.team}, ${role})${activeMarker}`
}

export function developerAccountRecord(account: DeveloperTeam, activeTeamId?: string) {
  return {
    accountId: account.team,
    name: developerAccountName(account),
    role: account.role ?? null,
    active: account.team === activeTeamId
  }
}

export async function switchDeveloperAccount(
  client: DeveloperAccountClient,
  configDir: string,
  selected: DeveloperTeam,
  memberships: DeveloperTeam[]
): Promise<{ changed: boolean; selectedAppCleared: boolean }> {
  if (selected.team === client.activeTeamId) return { changed: false, selectedAppCleared: false }
  const previousApp = await getSelectedApp(configDir, client.activeProfileName)
  const selectedAppCleared = await clearSelectedApp(configDir, client.activeProfileName)
  try {
    await client.selectDeveloperTeam(selected.team, memberships)
  } catch (error) {
    /* Restore the old account's app pointer when credential persistence fails,
       keeping both local context files on the same account. */
    if (selectedAppCleared && previousApp) {
      try {
        await saveSelectedApp(configDir, client.activeProfileName, previousApp)
      } catch {
        throw new Error('Account switch failed and the previous app selection could not be restored.', { cause: error })
      }
    }
    throw error
  }
  return { changed: true, selectedAppCleared }
}
