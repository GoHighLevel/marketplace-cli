import { setTimeout as delay } from 'node:timers/promises'

import open from 'open'
import { z } from 'zod'

import type { ApiClient } from '../../api/client.js'
import type { AppListItem, AppListResponse, DeveloperTeam } from '../../api/types.js'
import { developerAccountSummary, switchDeveloperAccount } from '../../auth/accounts.js'
import { startBrowserLogin } from '../../auth/browser-login.js'
import type { SandboxAccount } from '../../api/types.js'
import { createSandboxInLedger, deleteSandboxAndSecret, findSandbox } from '../../sandbox/accounts.js'
import { loadCredentials } from '../../auth/token-store.js'
import type { CliConfig } from '../../config/environment.js'
import { getSelectedApp } from '../../config/selection-store.js'
import { CodedError, errorMessage } from '../../shared/errors.js'
import { isDeveloperTeamId } from '../../shared/validation.js'
import { required } from '../inputs.js'
import { portalClient, whenLoggedIn } from '../portal.js'
import { oneLine } from '../text.js'
import { defineTool, textResult, type Toolset } from '../tool.js'

export interface AccountToolsetOptions {
  openUrl?: (url: string) => Promise<unknown>
  /* How long one login call waits for approval before returning, kept under
     the 60-second tool timeout some clients enforce. */
  approvalWaitMs?: number
}

type LoginOutcome = { developer?: string } | { error: unknown }

interface PendingLogin {
  url: string
  outcome: Promise<LoginOutcome>
}

interface SignedInAccount {
  client: ApiClient
  teams: DeveloperTeam[]
}

const APPS_LIMIT = 50
/* A switch only confirms where the user landed; get-account searches the rest. */
const SWITCH_APPS_LIMIT = 10
const DEFAULT_APPROVAL_WAIT_MS = 45_000
const LOGIN_VALID_MINUTES = 5

const accountInput = {
  search: z.string().trim().min(1).max(100).optional().describe('Only apps whose name contains this text.')
}

const switchInput = {
  accountId: z
    .string()
    .trim()
    .refine(isDeveloperTeamId, 'Use an account id from get-account.')
    .describe('Account id from get-account.')
}

const sandboxInput = {
  action: z.enum(['list', 'create', 'delete']).describe('list, create, or delete sandbox agencies.'),
  name: z.string().trim().min(1).max(100).optional().describe('create: the sandbox agency name.'),
  sandboxId: z.string().trim().min(1).max(128).optional().describe('delete: the company id from list.')
}

const loginInput = {
  force: z.boolean().default(false).describe('Log in again even though a session works, e.g. as another developer.')
}

async function signedInAccount(config: CliConfig): Promise<SignedInAccount> {
  const client = await portalClient(config)
  const teams = await client.listDeveloperTeams()
  await client.ensureTeam(teams)
  return { client, teams }
}

function identity(client: ApiClient): string {
  return `${client.activeEmail ? `Logged in as ${oneLine(client.activeEmail, 200)}` : 'Logged in'} (profile "${client.activeProfileName}")`
}

function accountsText(client: ApiClient, teams: readonly DeveloperTeam[]): string {
  const active = teams.find(team => team.team === client.activeTeamId)
  const others = teams.filter(team => team !== active)
  return [
    `${identity(client)}.`,
    active ? `Active account: ${developerAccountSummary(active)}${active.role ? `, ${active.role}` : ''}.` : '',
    others.length > 0 ? `Other accounts: ${others.map(developerAccountSummary).join('; ')}.` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function appLine(app: AppListItem, selectedAppId: string | undefined): string {
  const appId = app.appId ?? app._id
  /* Unpublished apps report "draft" as both version and status. */
  const details = [...new Set([app.version, app.status, app.private ? 'private' : 'public'])]
    .filter(Boolean)
    .map(detail => oneLine(detail, 40))
    .join(', ')
  const selected = appId === selectedAppId ? ' [selected]' : ''
  return `- ${oneLine(app.name, 100)}: appId ${oneLine(appId, 128)} (${details})${selected}`
}

function appsText(
  result: AppListResponse,
  selectedAppId: string | undefined,
  search: string | undefined,
  narrow: string
): string {
  if (result.apps.length === 0) {
    return search ? `No apps match "${search}".` : 'No apps in this account yet. create-app makes one.'
  }
  const more =
    result.totalCount > result.apps.length
      ? [`[Showing ${result.apps.length} of ${result.totalCount}; ${narrow}.]`]
      : []
  return [
    `Apps${search ? ` matching "${search}"` : ''} (${result.totalCount}):`,
    ...result.apps.map(app => appLine(app, selectedAppId)),
    ...more
  ].join('\n')
}

async function appsInAccount(config: CliConfig, client: ApiClient, search?: string): Promise<string> {
  const [apps, selected] = await Promise.all([
    client.listApps({ skip: 0, limit: APPS_LIMIT, search }),
    getSelectedApp(config.configDir, client.activeProfileName)
  ])
  return appsText(apps, selected?.appId, search, 'pass search to narrow')
}

/* A new account has no app selected yet. */
async function firstAppsInAccount(client: ApiClient): Promise<string> {
  const apps = await client.listApps({ skip: 0, limit: SWITCH_APPS_LIMIT })
  return appsText(apps, undefined, undefined, 'get-account with search finds the others')
}

async function settledWithin<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  const timer = new AbortController()
  try {
    return await Promise.race([promise, delay(milliseconds, undefined, { signal: timer.signal })])
  } finally {
    timer.abort()
  }
}

/* One browser login at a time, shared by concurrent calls. A call waits a
   bounded time for approval; an approval that arrives later still completes
   in the background, so the next portal call simply works. The callback
   server never keeps the process alive once the client disconnects. */
function browserLoginFlow(config: CliConfig, options: AccountToolsetOptions) {
  const openUrl = options.openUrl ?? open
  const waitMs = options.approvalWaitMs ?? DEFAULT_APPROVAL_WAIT_MS
  let pending: Promise<PendingLogin> | undefined

  async function begin(): Promise<PendingLogin> {
    const { activeProfile } = await loadCredentials(config.configDir)
    const login = await startBrowserLogin(config, activeProfile, { keepProcessAlive: false })
    const outcome = login.approval.then(login.signIn).then(
      (developer): LoginOutcome => ({ developer }),
      (error: unknown): LoginOutcome => ({ error })
    )
    await openUrl(login.url).catch(() => undefined)
    return { url: login.url, outcome }
  }

  function start(): Promise<PendingLogin> {
    const flow = begin()
    pending = flow
    const clear = () => {
      if (pending === flow) pending = undefined
    }
    flow.then(started => started.outcome).then(clear, clear)
    return flow
  }

  return async (force: boolean): Promise<string> => {
    if (!force && !pending) {
      const current = await whenLoggedIn(signedInAccount(config))
      if (current) {
        return `${accountsText(current.client, current.teams)}\nThe session works; pass force: true only to log in as another developer.`
      }
    }
    const flow = await (pending ?? start())
    const outcome = await settledWithin(flow.outcome, waitMs)
    if (!outcome) {
      return `Opened the HighLevel login page in the browser. Ask the user to approve it there (${flow.url}); the login completes on its own within ${LOGIN_VALID_MINUTES} minutes, after which portal tools work without calling login again.`
    }
    if ('error' in outcome) throw new CodedError('LOGIN_FAILED', errorMessage(outcome.error, 'Login failed.'))
    return `Logged in${outcome.developer ? ` as ${oneLine(outcome.developer, 200)}` : ''}. Portal tools now use this session.`
  }
}

function sandboxSummary(account: SandboxAccount, apps: readonly string[]): string {
  const details = [
    `company id ${oneLine(account.companyId ?? account._id, 128)}`,
    account.relationshipNumber && `relationship ${oneLine(account.relationshipNumber, 40)}`,
    account.status && oneLine(account.status, 40),
    account.expiryDate && `expires ${oneLine(account.expiryDate.slice(0, 10), 20)}`,
    apps.length > 0 && `apps: ${apps.map(app => oneLine(app, 80)).join(', ')}`
  ].filter(Boolean)
  return `${oneLine(account.name ?? 'unnamed', 100)} (${details.join(', ')})`
}

async function manageSandbox(
  config: CliConfig,
  request: { action: 'list' | 'create' | 'delete'; name?: string; sandboxId?: string }
): Promise<string> {
  const name = request.action === 'create' ? required(request.name, 'create needs a sandbox name.') : undefined
  const sandboxId =
    request.action === 'delete' ? required(request.sandboxId, 'delete needs the sandboxId from list.') : undefined
  const client = await portalClient(config)
  if (name !== undefined) {
    const account = await createSandboxInLedger(client, config.configDir, name)
    return `Created sandbox agency ${sandboxSummary(account, [])}. Log in with your developer email; the password is stored locally only, and the user can view it once with \`ghl secrets reveal\`.`
  }
  const { accounts, apps } = await client.listSandboxAccounts()
  if (sandboxId === undefined) {
    if (accounts.length === 0) return 'No sandbox agencies yet; manage-sandbox create makes one.'
    return accounts.map(account => `- ${sandboxSummary(account, apps[account.companyId ?? ''] ?? [])}`).join('\n')
  }
  const account = findSandbox(accounts, sandboxId)
  if (!account) throw new CodedError('NOT_FOUND', `No sandbox with id "${sandboxId}"; manage-sandbox list shows them.`)
  const ledgerUpdated = await deleteSandboxAndSecret(client, config.configDir, account)
  return `Deleted sandbox agency ${oneLine(account.name ?? sandboxId, 100)} and its data.${ledgerUpdated ? '' : ' The local secrets ledger could not be updated.'}`
}

export function accountToolset(config: CliConfig, options: AccountToolsetOptions = {}): Toolset {
  const login = browserLoginFlow(config, options)
  return {
    name: 'account',
    instructions: [
      'Portal tools use the developer session from `ghl login`. On AUTH_REQUIRED, call login once; the user approves in the browser.'
    ],
    tools: [
      defineTool({
        name: 'get-account',
        title: 'Show the developer account and its apps',
        description:
          'Who is logged in, the active developer account and the other accounts available, and the apps in the active account with their appIds, versions, and status.',
        input: accountInput,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        run: async ({ search }) => {
          const { client, teams } = await signedInAccount(config)
          return textResult(`${accountsText(client, teams)}\n${await appsInAccount(config, client, search)}`)
        }
      }),
      defineTool({
        name: 'switch-account',
        title: 'Switch the active developer account',
        description:
          'Makes another developer account (team) active for the CLI and these tools, then lists its apps. Only when the user asks to switch.',
        input: switchInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        run: async ({ accountId }) => {
          const { client, teams } = await signedInAccount(config)
          const target = teams.find(team => team.team === accountId)
          if (!target) {
            throw new CodedError(
              'NOT_FOUND',
              `Account "${accountId}" is not available. Accounts: ${teams.map(developerAccountSummary).join('; ')}.`
            )
          }
          const { changed, selectedAppCleared } = await switchDeveloperAccount(client, config.configDir, target, teams)
          const status = changed
            ? `Switched to ${developerAccountSummary(target)}.${selectedAppCleared ? ' The app selected in the previous account was cleared.' : ''}`
            : `${developerAccountSummary(target)} is already the active account.`
          return textResult(`${status}\n${await firstAppsInAccount(client)}`)
        }
      }),
      defineTool({
        name: 'manage-sandbox',
        title: 'List, create, or delete sandbox agencies',
        description:
          'Lists the sandbox agencies used to install and test apps, creates one (its password goes to the local secrets ledger, never to this conversation), or deletes one with its data.',
        input: sandboxInput,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        run: async request => textResult(await manageSandbox(config, request))
      }),
      defineTool({
        name: 'login',
        title: 'Log in to the developer portal',
        description:
          'Opens the HighLevel developer portal in the browser so the user can approve a CLI login, and waits for it. Call it when a tool returns AUTH_REQUIRED.',
        input: loginInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        run: async ({ force }) => textResult(await login(force))
      })
    ]
  }
}
