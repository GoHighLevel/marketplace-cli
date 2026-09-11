import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  buildAppInstructionDocument,
  buildManagedCommandReference,
  COMMAND_REFERENCE_END,
  COMMAND_REFERENCE_START
} from './command-reference.js'
import { APP_GUIDE_END, APP_GUIDE_START, buildHighLevelAppGuide } from './structure-guide.js'
import { writeTextFileAtomic } from '../shared/atomic-file.js'

export const AGENTS_FILENAME = 'AGENTS.md'
export const CLAUDE_FILENAME = 'CLAUDE.md'
export const HIGHLEVEL_APP_FILENAME = 'HIGHLEVEL_APP.md'
const MAX_INSTRUCTION_FILE_BYTES = 2 * 1024 * 1024

const LEGACY_VALIDATE_INSTRUCTION = "- Run `ghl app validate` to check the selected app's remote publish readiness."
const LEGACY_PULL_INSTRUCTION =
  '- Run `ghl app pull <appId> --directory <parent> --folder <name>` to refresh generated JSON from the developer portal.'
const CURRENT_PULL_INSTRUCTION =
  '- Run `ghl app pull` from this workspace to refresh generated JSON from the developer portal.'
const LOCAL_SYNC_INSTRUCTIONS = `- Edit \`ghl-app.json\` and any configured module files locally; webhook commands create \`src/webhooks/ghl-webhooks.json\` when needed.
- Run \`ghl app validate\` before pushing; this check is local and does not call an API.
- Run \`ghl app diff\` to compare local, last-pulled, and current portal values.
- Run \`ghl app push\` to validate again and update only the changed API sections.
- Run \`ghl app validate --remote\` to check publish readiness on the server.`

function updateLegacyInstructions(contents: string): string {
  let updated = contents
    .replace(LEGACY_VALIDATE_INSTRUCTION, LOCAL_SYNC_INSTRUCTIONS)
    .replace(LEGACY_PULL_INSTRUCTION, CURRENT_PULL_INSTRUCTION)
  if (!updated.includes('`.ghl/state.json`')) {
    updated = updated.replace(
      '- `src/webhooks/ghl-webhooks.json` contains the webhook URL and event subscriptions.',
      '- `src/webhooks/ghl-webhooks.json` contains configured webhook settings and is omitted when unused.\n' +
        '- `.ghl/state.json` records the last pull baseline for conflict detection and must not be edited manually.'
    )
  }
  return updated
}

function upsertManagedSection(
  contents: string,
  section: string,
  startMarker: string,
  endMarker: string,
  label: string
): string {
  const start = contents.indexOf(startMarker)
  const end = contents.indexOf(endMarker)
  if (start === -1 && end === -1) return `${contents.trimEnd()}\n\n${section}\n`
  if (start === -1 || end < start) {
    throw new Error(`Generated ${label} markers are incomplete; restore or remove both markers and retry.`)
  }
  return `${contents.slice(0, start)}${section}${contents.slice(end + endMarker.length)}`
}

function upsertCommandReference(contents: string): string {
  return upsertManagedSection(
    contents,
    buildManagedCommandReference(),
    COMMAND_REFERENCE_START,
    COMMAND_REFERENCE_END,
    'command reference'
  )
}

async function instructionFileStat(filePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function assertInstructionFileWritable(filePath: string): Promise<boolean> {
  const stat = await instructionFileStat(filePath)
  if (!stat) return false
  if (stat.isSymbolicLink()) throw new Error(`Workspace documentation file "${filePath}" cannot be a symbolic link.`)
  if (!stat.isFile()) throw new Error(`Workspace documentation path "${filePath}" is not a regular file.`)
  if (stat.size > MAX_INSTRUCTION_FILE_BYTES) {
    throw new Error(`Workspace documentation file "${filePath}" must be at most 2 MiB.`)
  }
  return true
}

export async function assertWorkspaceDocumentationFilesWritable(directory: string): Promise<void> {
  await Promise.all(
    [AGENTS_FILENAME, CLAUDE_FILENAME, HIGHLEVEL_APP_FILENAME].map(fileName =>
      assertInstructionFileWritable(path.join(directory, fileName))
    )
  )
}

async function writeInstructionFile(directory: string, fileName: 'AGENTS.md' | 'CLAUDE.md'): Promise<void> {
  const filePath = path.join(directory, fileName)
  let contents: string
  if (await assertInstructionFileWritable(filePath)) {
    contents = await fs.readFile(filePath, 'utf8')
    contents = upsertCommandReference(updateLegacyInstructions(contents))
  } else {
    contents = buildAppInstructionDocument(fileName)
  }
  await writeTextFileAtomic(filePath, contents)
}

async function writeAppGuide(directory: string): Promise<void> {
  const filePath = path.join(directory, HIGHLEVEL_APP_FILENAME)
  let contents = buildHighLevelAppGuide()
  if (await assertInstructionFileWritable(filePath)) {
    contents = upsertManagedSection(
      await fs.readFile(filePath, 'utf8'),
      contents,
      APP_GUIDE_START,
      APP_GUIDE_END,
      'app guide'
    )
  }
  await writeTextFileAtomic(filePath, contents)
}

export async function writeWorkspaceDocumentation(directory: string): Promise<void> {
  await Promise.all([
    writeInstructionFile(directory, AGENTS_FILENAME),
    writeInstructionFile(directory, CLAUDE_FILENAME),
    writeAppGuide(directory)
  ])
}
