import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeveloperTeam } from '../../../src/lib/api/client.js'
import { getSelectedApp, saveSelectedApp } from '../../../src/lib/config/selection-store.js'
import {
  developerAccountChoice,
  developerAccountSummary,
  switchDeveloperAccount
} from '../../../src/lib/auth/accounts.js'

const teams: DeveloperTeam[] = [
  { team: 'team1', name: 'Primary', role: 'OWNER' },
  { team: 'team2', name: 'Partner', role: 'ADMIN' }
]

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-accounts-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('developer accounts', () => {
  it('identifies the current account in picker and summary labels', () => {
    expect(developerAccountSummary(teams[0])).toBe('Primary (team1)')
    expect(developerAccountChoice(teams[0], 'team1')).toBe('Primary (team1, OWNER) — active')
    expect(developerAccountChoice(teams[1], 'team1')).toBe('Partner (team2, ADMIN)')
  })

  it('clears the previous account app selection after a verified switch', async () => {
    await saveSelectedApp(dir, 'default', { appId: 'app1', versionId: 'version1' })
    const client = {
      activeProfileName: 'default',
      activeTeamId: 'team1',
      selectDeveloperTeam: vi.fn().mockResolvedValue(teams[1])
    }

    const result = await switchDeveloperAccount(client, dir, teams[1], teams)

    expect(result).toEqual({ changed: true, selectedAppCleared: true })
    expect(client.selectDeveloperTeam).toHaveBeenCalledWith('team2', teams)
    expect(await getSelectedApp(dir, 'default')).toBeUndefined()
  })

  it('does not rewrite account or app state when the account is already active', async () => {
    await saveSelectedApp(dir, 'default', { appId: 'app1', versionId: 'version1' })
    const client = {
      activeProfileName: 'default',
      activeTeamId: 'team1',
      selectDeveloperTeam: vi.fn()
    }

    const result = await switchDeveloperAccount(client, dir, teams[0], teams)

    expect(result).toEqual({ changed: false, selectedAppCleared: false })
    expect(client.selectDeveloperTeam).not.toHaveBeenCalled()
    expect((await getSelectedApp(dir, 'default'))?.appId).toBe('app1')
  })

  it('restores the prior app selection if persisting the account fails', async () => {
    await saveSelectedApp(dir, 'default', { appId: 'app1', versionId: 'version1', name: 'App One' })
    const client = {
      activeProfileName: 'default',
      activeTeamId: 'team1',
      selectDeveloperTeam: vi.fn().mockRejectedValue(new Error('credential write failed'))
    }

    await expect(switchDeveloperAccount(client, dir, teams[1], teams)).rejects.toThrow(/credential write failed/i)
    expect(await getSelectedApp(dir, 'default')).toEqual({ appId: 'app1', versionId: 'version1', name: 'App One' })
  })
})
