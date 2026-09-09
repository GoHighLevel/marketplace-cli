import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readJsonFile } from '../../../src/lib/shared/json-file.js'
import { JSON_SCHEMA_REFERENCES } from '../../../src/lib/app/json-schema.js'
import {
  AGENTS_FILENAME,
  APP_MANIFEST_FILENAME,
  CLAUDE_FILENAME,
  HIGHLEVEL_APP_FILENAME,
  WEBHOOK_MANIFEST_FILENAME,
  WEBHOOK_MANIFEST_RELATIVE_PATH,
  WORKSPACE_STATE_RELATIVE_PATH,
  assertAppDirectoryAvailable,
  resolveAppDirectory,
  slugifyAppName,
  writeAppWorkspace
} from '../../../src/lib/app/workspace.js'

let directory: string

async function sourceCommandNames(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async entry => {
      const entryPath = path.join(root, entry.name)
      if (entry.isDirectory()) return sourceCommandNames(entryPath)
      if (!entry.isFile() || !entry.name.endsWith('.ts')) return []
      const relative = path.relative(path.resolve('src', 'commands'), entryPath).replace(/\.ts$/, '')
      const parts = relative.split(path.sep)
      if (parts.at(-1) === 'index') parts.pop()
      return [`ghl ${parts.join(' ')}`]
    })
  )
  return nested.flat()
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-app-workspace-'))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('app workspace paths', () => {
  it('creates stable app-name slugs and a safe fallback', () => {
    expect(slugifyAppName('  Acme CRM ++  ')).toBe('acme-crm')
    expect(slugifyAppName('Crème Déjà Vu')).toBe('creme-deja-vu')
    expect(slugifyAppName('東京', '6a7992626bfb7595f0848339')).toBe('ghl-app-f0848339')
  })

  it('rejects traversal, separators, platform-reserved names, and invalid parents', async () => {
    for (const folder of ['..', '../outside', 'nested/folder', 'nested\\folder', 'CON', 'bad:name']) {
      expect(() => resolveAppDirectory(directory, folder)).toThrow(/folder name/i)
    }

    const fileParent = path.join(directory, 'not-a-directory')
    await fs.writeFile(fileParent, 'x')
    await expect(assertAppDirectoryAvailable(resolveAppDirectory(fileParent, 'app'))).rejects.toThrow(/not a directory/i)
  })

  it('fails before mutation when an unrelated non-empty folder would be overwritten', async () => {
    const target = resolveAppDirectory(directory, 'existing')
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, 'README.md'), 'user content')

    await expect(assertAppDirectoryAvailable(target)).rejects.toThrow(/not an app workspace|choose another/i)
    await expect(fs.readFile(path.join(target, 'README.md'), 'utf8')).resolves.toBe('user content')
  })
})

describe('writeAppWorkspace', () => {
  it('omits webhook files and directories when the app has no webhook configuration', async () => {
    const target = resolveAppDirectory(directory, 'without-webhooks')
    const result = await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })

    expect(result.webhookFile).toBeUndefined()
    await expect(fs.stat(path.join(target, 'src'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readJsonFile(result.stateFile)).resolves.toMatchObject({
      baseline: { webhooks: { webhookUrl: '', subscribedEvents: [] } }
    })
  })

  it('removes a generated webhook directory when refreshed configuration becomes empty', async () => {
    const target = resolveAppDirectory(directory, 'removed-webhooks')
    const configured = await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme', subscribedEvents: [{ name: 'ContactUpdate' }] }
    })
    expect(configured.webhookFile).toBeDefined()

    const refreshed = await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })

    expect(refreshed.webhookFile).toBeUndefined()
    await expect(fs.stat(path.join(target, 'src', 'webhooks'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes app metadata, nested webhooks, and complete agent guidance', async () => {
    const target = resolveAppDirectory(directory, 'acme')
    const result = await writeAppWorkspace({
      directory: target,
      version: {
        _id: 'version-1',
        appId: 'app-1',
        name: 'Acme',
        webhookUrl: 'https://acme.test/webhooks'
      }
    })

    expect(result).toEqual({
      directory: target,
      appFile: path.join(target, APP_MANIFEST_FILENAME),
      webhookFile: path.join(target, WEBHOOK_MANIFEST_RELATIVE_PATH),
      stateFile: path.join(target, WORKSPACE_STATE_RELATIVE_PATH)
    })
    await expect(readJsonFile(result.appFile)).resolves.toMatchObject({
      $schema: JSON_SCHEMA_REFERENCES.app,
      appId: 'app-1',
      versionId: 'version-1'
    })
    await expect(readJsonFile(result.webhookFile!)).resolves.toMatchObject({
      $schema: JSON_SCHEMA_REFERENCES.webhooks,
      webhookUrl: 'https://acme.test/webhooks'
    })
    expect((await fs.stat(result.appFile)).mode & 0o777).toBe(0o644)
    expect((await fs.stat(result.webhookFile!)).mode & 0o777).toBe(0o644)
    const state = await readJsonFile<Record<string, unknown>>(result.stateFile)
    expect(state).toMatchObject({
      schemaVersion: 1,
      appId: 'app-1',
      versionId: 'version-1',
      baseline: {
        app: { appId: 'app-1', versionId: 'version-1' },
        webhooks: { appId: 'app-1', versionId: 'version-1' }
      }
    })
    expect(state).not.toHaveProperty('baseline.app.$schema')
    expect(state).not.toHaveProperty('baseline.webhooks.$schema')
    expect((await fs.stat(result.stateFile)).mode & 0o777).toBe(0o600)
    expect((await fs.stat(path.dirname(result.stateFile))).mode & 0o777).toBe(0o700)
    expect((await fs.stat(target)).mode & 0o777).toBe(0o755)
    await expect(fs.stat(path.join(target, WEBHOOK_MANIFEST_FILENAME))).rejects.toMatchObject({ code: 'ENOENT' })
    const commandNames = [...(await sourceCommandNames(path.resolve('src', 'commands'))), 'ghl help', 'ghl commands']
    const agents = await fs.readFile(path.join(target, AGENTS_FILENAME), 'utf8')
    const claude = await fs.readFile(path.join(target, CLAUDE_FILENAME), 'utf8')
    const appGuide = await fs.readFile(path.join(target, HIGHLEVEL_APP_FILENAME), 'utf8')
    expect(agents).toMatch(
      /GHL marketplace app workspace[\s\S]*ghl-app\.json[\s\S]*src\/webhooks\/ghl-webhooks\.json[\s\S]*complete command reference/i
    )
    expect(claude).toMatch(/CLAUDE\.md[\s\S]*Claude Code[\s\S]*complete command reference/i)
    for (const command of commandNames) {
      expect(agents, `${command} missing from AGENTS.md`).toContain(`\`${command}`)
      expect(claude, `${command} missing from CLAUDE.md`).toContain(`\`${command}`)
    }
    expect(appGuide).toMatch(
      /HighLevel marketplace app[\s\S]*Workspace structure[\s\S]*ghl-app\.json[\s\S]*src\/webhooks\/ghl-webhooks\.json[\s\S]*App configuration sections[\s\S]*Version model[\s\S]*Local workflow/i
    )
    expect(appGuide).toMatch(
      /customVarsJson[\s\S]*customVars[\s\S]*branchesConfig[\s\S]*conditionType[\s\S]*branchId/i
    )
    expect(appGuide).toMatch(
      /src\/modules\/workflows\/actions[\s\S]*one JSON file per action[\s\S]*required[\s\S]*key[\s\S]*filename/i
    )
    for (const section of ['Basic information', 'Listing', 'Profiles', 'OAuth', 'Support', 'Billing', 'Review', 'Webhooks']) {
      expect(appGuide).toContain(section)
    }
    expect(appGuide).toMatch(/external authentication[\s\S]*MCP configuration[\s\S]*custom pages/i)
    expect((await fs.stat(path.join(target, AGENTS_FILENAME))).mode & 0o777).toBe(0o644)
    expect((await fs.stat(path.join(target, CLAUDE_FILENAME))).mode & 0o777).toBe(0o644)
    expect((await fs.stat(path.join(target, HIGHLEVEL_APP_FILENAME))).mode & 0o777).toBe(0o644)
    expect((await fs.stat(path.dirname(result.webhookFile!))).mode & 0o777).toBe(0o755)
    expect((await fs.readdir(directory)).filter(name => name.includes('.tmp') || name.includes('.stage'))).toEqual([])
  })

  it('refreshes a workspace only when it is bound to the same app', async () => {
    const target = resolveAppDirectory(directory, 'acme')
    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme', tagline: 'Old' }
    })
    await fs.writeFile(path.join(target, 'developer-file.ts'), 'preserve me')
    await fs.writeFile(path.join(target, AGENTS_FILENAME), 'custom agent instructions\n')
    await fs.chmod(target, 0o700)

    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-2', appId: 'app-1', name: 'Acme', tagline: 'New' }
    })
    await expect(readJsonFile(path.join(target, APP_MANIFEST_FILENAME))).resolves.toMatchObject({
      versionId: 'version-2',
      basicInfo: { tagline: 'New' }
    })
    await expect(fs.readFile(path.join(target, 'developer-file.ts'), 'utf8')).resolves.toBe('preserve me')
    const customInstructions = await fs.readFile(path.join(target, AGENTS_FILENAME), 'utf8')
    expect(customInstructions).toMatch(/^custom agent instructions[\s\S]*complete command reference/i)
    await expect(fs.readFile(path.join(target, CLAUDE_FILENAME), 'utf8')).resolves.toMatch(/complete command reference/i)
    expect((await fs.stat(target)).mode & 0o777).toBe(0o700)

    await expect(
      writeAppWorkspace({
        directory: target,
        version: { _id: 'other-version', appId: 'other-app', name: 'Other' }
      })
    ).rejects.toThrow(/belongs to app "app-1"/i)
  })

  it('upgrades obsolete generated agent workflow text without replacing custom content', async () => {
    const target = resolveAppDirectory(directory, 'legacy-instructions')
    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })
    const agentFile = path.join(target, AGENTS_FILENAME)
    await fs.writeFile(
      agentFile,
      '# Custom heading\n\n- `src/webhooks/ghl-webhooks.json` contains the webhook URL and event subscriptions.\n' +
        "- Run `ghl app validate` to check the selected app's remote publish readiness.\n\nCustom footer.\n"
    )

    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })

    const instructions = await fs.readFile(agentFile, 'utf8')
    expect(instructions).toMatch(/Custom heading[\s\S]*\.ghl\/state\.json[\s\S]*ghl app diff[\s\S]*Custom footer/)
    expect(instructions).not.toContain("selected app's remote publish readiness")
  })

  it('upgrades the old generated pull instruction without replacing custom content', async () => {
    const target = resolveAppDirectory(directory, 'legacy-pull-instructions')
    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })
    const agentFile = path.join(target, AGENTS_FILENAME)
    await fs.writeFile(
      agentFile,
      '# Custom heading\n\n' +
        '- Run `ghl app pull <appId> --directory <parent> --folder <name>` to refresh generated JSON from the developer portal.\n\n' +
        'Custom footer.\n'
    )

    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })

    await expect(fs.readFile(agentFile, 'utf8')).resolves.toMatch(
      /Custom heading[\s\S]*ghl app pull` from this workspace[\s\S]*Custom footer/
    )
  })

  it('preserves custom app-guide content while adding and refreshing the managed structure guide', async () => {
    const target = resolveAppDirectory(directory, 'custom-app-guide')
    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })
    const guideFile = path.join(target, HIGHLEVEL_APP_FILENAME)
    await fs.writeFile(guideFile, '# Team notes\n\nKeep this custom section.\n')

    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })
    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })

    const guide = await fs.readFile(guideFile, 'utf8')
    expect(guide).toMatch(/^# Team notes[\s\S]*Keep this custom section[\s\S]*HighLevel marketplace app/i)
    expect(guide.match(/ghl-cli-app-guide:start/g)).toHaveLength(1)
    expect(guide.match(/ghl-cli-app-guide:end/g)).toHaveLength(1)
  })

  it('migrates the generated legacy root webhook file without touching unrelated files', async () => {
    const target = resolveAppDirectory(directory, 'legacy')
    const first = await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme', webhookUrl: 'https://old.example.com' }
    })
    const legacyFile = path.join(target, WEBHOOK_MANIFEST_FILENAME)
    await fs.rename(first.webhookFile!, legacyFile)
    await fs.writeFile(path.join(target, 'developer-file.ts'), 'preserve me')

    const refreshed = await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-2', appId: 'app-1', name: 'Acme', webhookUrl: 'https://new.example.com' }
    })

    await expect(fs.stat(legacyFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readJsonFile(refreshed.webhookFile!)).resolves.toMatchObject({
      versionId: 'version-2',
      webhookUrl: 'https://new.example.com'
    })
    await expect(fs.readFile(path.join(target, 'developer-file.ts'), 'utf8')).resolves.toBe('preserve me')
  })

  it('refuses to delete an unrelated file using the legacy webhook name', async () => {
    const target = resolveAppDirectory(directory, 'legacy-conflict')
    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })
    const legacyFile = path.join(target, WEBHOOK_MANIFEST_FILENAME)
    await fs.writeFile(legacyFile, JSON.stringify({ appId: 'other-app', custom: true }))

    await expect(
      writeAppWorkspace({
        directory: target,
        version: { _id: 'version-2', appId: 'app-1', name: 'Acme' }
      })
    ).rejects.toThrow(/legacy webhook.*other-app/i)
    await expect(readJsonFile(legacyFile)).resolves.toEqual({ appId: 'other-app', custom: true })
  })

  it('refuses symlink workspaces instead of writing outside the chosen folder', async () => {
    const outside = path.join(directory, 'outside')
    const target = path.join(directory, 'linked')
    await fs.mkdir(outside)
    await fs.symlink(outside, target, 'dir')

    await expect(
      writeAppWorkspace({
        directory: target,
        version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
      })
    ).rejects.toThrow(/symbolic link/i)
    await expect(fs.readdir(outside)).resolves.toEqual([])
  })

  it.each([
    ['source directory', 'src'],
    ['webhook directory', path.join('src', 'webhooks')],
    ['state directory', '.ghl']
  ])('refuses a symbolic-link %s instead of writing outside the workspace', async (_label, relativePath) => {
    const target = resolveAppDirectory(directory, 'linked-content')
    await writeAppWorkspace({
      directory: target,
      version: { _id: 'version-1', appId: 'app-1', name: 'Acme' }
    })
    const outside = path.join(directory, `outside-${relativePath.replaceAll(path.sep, '-')}`)
    await fs.mkdir(outside)
    const linkedPath = path.join(target, relativePath)
    await fs.rm(linkedPath, { recursive: true, force: true })
    await fs.mkdir(path.dirname(linkedPath), { recursive: true })
    await fs.symlink(outside, linkedPath, 'dir')

    await expect(
      writeAppWorkspace({
        directory: target,
        version: { _id: 'version-2', appId: 'app-1', name: 'Acme' }
      })
    ).rejects.toThrow(/symbolic link/i)
    await expect(fs.readdir(outside)).resolves.toEqual([])
  })

  it.each([AGENTS_FILENAME, CLAUDE_FILENAME, HIGHLEVEL_APP_FILENAME])(
    'refuses a symbolic-link %s before changing generated app files',
    async instructionFile => {
      const target = resolveAppDirectory(directory, 'linked-instructions')
      const first = await writeAppWorkspace({
        directory: target,
        version: { _id: 'version-1', appId: 'app-1', name: 'Acme', tagline: 'Original' }
      })
      const outside = path.join(directory, `outside-${instructionFile}`)
      await fs.writeFile(outside, 'outside content\n')
      await fs.unlink(path.join(target, instructionFile))
      await fs.symlink(outside, path.join(target, instructionFile))

      await expect(
        writeAppWorkspace({
          directory: target,
          version: { _id: 'version-2', appId: 'app-1', name: 'Acme', tagline: 'Changed' }
        })
      ).rejects.toThrow(/symbolic link/i)
      await expect(fs.readFile(outside, 'utf8')).resolves.toBe('outside content\n')
      await expect(readJsonFile(first.appFile)).resolves.toMatchObject({
        versionId: 'version-1',
        basicInfo: { tagline: 'Original' }
      })
    }
  )
})
