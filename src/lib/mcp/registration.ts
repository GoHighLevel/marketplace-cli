import { constants, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isRecord, sanitizeTerminalText } from '../api/response.js'
import { writeTextFileAtomic } from '../shared/atomic-file.js'
import { errorMessage } from '../shared/errors.js'
import { type ExecutableResult, findExecutable, runExecutable } from '../shared/executable.js'
import { parseJsoncObject, setJsoncValue } from '../shared/jsonc.js'
import { platformPath } from '../shared/platform.js'
import type {
  ClientEnvironment,
  CliRegistration,
  FileRegistration,
  McpClient,
  McpClientId,
  McpLaunchCommand
} from './clients.js'

export interface RegistrationDependencies extends ClientEnvironment {
  findExecutable: (name: string) => Promise<string | undefined>
  runExecutable: (file: string, args: readonly string[]) => Promise<ExecutableResult>
}

export interface RegistrationResult {
  client: McpClientId
  label: string
  status: 'configured' | 'failed'
  target: string
  message?: string
}

const NEW_CONFIG_MODE = 0o600
const NEW_DIRECTORY_MODE = 0o700
const FAILURE_DETAIL_LENGTH = 300
const MAX_SYMLINK_HOPS = 8
const ALREADY_REGISTERED = /already exists/i

export function defaultRegistrationDependencies(): RegistrationDependencies {
  const environment: ClientEnvironment = { home: os.homedir(), env: process.env, platform: process.platform }
  return {
    ...environment,
    findExecutable: name => findExecutable(name, environment.env, environment.platform),
    runExecutable: (file, args) => runExecutable(file, args, { platform: environment.platform })
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory()
  } catch {
    return false
  }
}

function displayPath(file: string, { home, platform }: ClientEnvironment): string {
  const api = platformPath(platform)
  const relative = api.relative(home, file)
  return relative && !relative.startsWith('..') && !api.isAbsolute(relative) ? api.join('~', relative) : file
}

export async function isClientInstalled(client: McpClient, dependencies: RegistrationDependencies): Promise<boolean> {
  const registration = client.registration
  const configDirectory =
    registration.kind === 'file' ? platformPath(dependencies.platform).dirname(registration.file(dependencies)) : ''
  if (configDirectory && (await directoryExists(configDirectory))) {
    return true
  }
  return registration.executable ? (await dependencies.findExecutable(registration.executable)) !== undefined : false
}

export async function detectInstalledClients(
  clients: readonly McpClient[],
  dependencies: RegistrationDependencies
): Promise<McpClientId[]> {
  const installed = await Promise.all(clients.map(client => isClientInstalled(client, dependencies)))
  return clients.filter((_, index) => installed[index]).map(client => client.id)
}

async function readTextIfPresent(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

/* Dotfile managers often symlink client configs; writing to the resolved
   target keeps the link intact instead of replacing it with a copy. A
   dangling link still names where the user keeps the file. */
async function resolveConfigTarget(file: string, hops = 0): Promise<string> {
  try {
    return await fs.realpath(file)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
  const link = await fs.lstat(file).catch(() => undefined)
  if (!link?.isSymbolicLink()) return file
  if (hops === MAX_SYMLINK_HOPS) throw new Error(`${path.basename(file)} has too many symbolic links.`)
  return resolveConfigTarget(path.resolve(path.dirname(file), await fs.readlink(file)), hops + 1)
}

/* Keeps an existing file's permissions and respects a deliberately
   read-only config instead of replacing it through the directory. */
async function writableMode(file: string): Promise<number> {
  let mode: number
  try {
    mode = (await fs.stat(file)).mode & 0o777
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return NEW_CONFIG_MODE
    throw error
  }
  try {
    await fs.access(file, constants.W_OK)
  } catch {
    throw new Error(`${path.basename(file)} is read-only; make it writable and run setup again.`)
  }
  return mode
}

/* Sets one server entry and leaves every other server, setting, comment,
   and the file's formatting untouched. Invalid files are never rewritten. */
export async function upsertServerEntry(
  file: string,
  rootKey: string,
  name: string,
  entry: Record<string, unknown>
): Promise<void> {
  const target = await resolveConfigTarget(file)
  const existing = await readTextIfPresent(target)
  const contents = existing?.trim() ? existing : '{}\n'
  const config = parseJsoncObject(contents, target)
  if (Object.hasOwn(config, rootKey) && !isRecord(config[rootKey])) {
    throw new Error(`${path.basename(target)} has a "${rootKey}" value that is not an object.`)
  }

  const updated = setJsoncValue(contents, [rootKey, name], entry)
  if (updated === existing) return
  const mode = await writableMode(target)
  await fs.mkdir(path.dirname(target), { recursive: true, mode: NEW_DIRECTORY_MODE })
  await writeTextFileAtomic(target, updated, mode)
}

function result(client: McpClient, target: string, message?: string): RegistrationResult {
  return {
    client: client.id,
    label: client.label,
    status: message ? 'failed' : 'configured',
    target,
    ...(message ? { message } : {})
  }
}

function succeeded(outcome: ExecutableResult): boolean {
  return outcome.exitCode === 0 && !outcome.timedOut
}

function commandFailure(executable: string, outcome: ExecutableResult): string {
  if (outcome.timedOut) return `${executable} timed out.`
  const detail = sanitizeTerminalText(outcome.stderr || outcome.stdout, FAILURE_DETAIL_LENGTH)
  return `${executable} exited with code ${outcome.exitCode ?? 'unknown'}${detail ? `: ${detail}` : '.'}`
}

async function registerWithCli(
  client: McpClient,
  registration: CliRegistration,
  name: string,
  launch: McpLaunchCommand,
  dependencies: RegistrationDependencies
): Promise<RegistrationResult> {
  const executable = await dependencies.findExecutable(registration.executable)
  if (!executable) return result(client, registration.target, `${registration.executable} was not found on PATH.`)

  const add = () => dependencies.runExecutable(executable, registration.addArgs(name, launch))
  /* Some clients refuse to overwrite an entry. It is removed only after the
     client confirms one exists, so a failing add never loses a working entry. */
  const replace = async () => {
    await dependencies.runExecutable(executable, registration.removeArgs(name))
    return add()
  }
  const first = await add()
  const exists = !succeeded(first) && ALREADY_REGISTERED.test(`${first.stderr}\n${first.stdout}`)
  const outcome = exists ? await replace() : first
  return succeeded(outcome)
    ? result(client, registration.target)
    : result(client, registration.target, commandFailure(registration.executable, outcome))
}

async function registerWithFile(
  client: McpClient,
  registration: FileRegistration,
  name: string,
  launch: McpLaunchCommand,
  dependencies: RegistrationDependencies
): Promise<RegistrationResult> {
  const file = registration.file(dependencies)
  const target = displayPath(file, dependencies)
  if (!(await isClientInstalled(client, dependencies))) {
    const directory = displayPath(platformPath(dependencies.platform).dirname(file), dependencies)
    return result(client, target, `${client.label} was not detected (${directory} does not exist).`)
  }
  await upsertServerEntry(file, registration.rootKey, name, registration.entry(launch))
  return result(client, target)
}

/* Each client succeeds or fails on its own so one broken client never
   blocks the others. */
export async function registerMcpClient(
  client: McpClient,
  name: string,
  launch: McpLaunchCommand,
  dependencies: RegistrationDependencies
): Promise<RegistrationResult> {
  const registration = client.registration
  try {
    return registration.kind === 'cli'
      ? await registerWithCli(client, registration, name, launch, dependencies)
      : await registerWithFile(client, registration, name, launch, dependencies)
  } catch (error) {
    const target =
      registration.kind === 'cli' ? registration.target : displayPath(registration.file(dependencies), dependencies)
    return result(client, target, errorMessage(error, `Could not configure ${client.label}.`))
  }
}
