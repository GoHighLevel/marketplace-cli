import { isExpired, loadActiveSession, refreshSession } from '../auth/session.js'
import { saveProfile, type StoredProfile } from '../auth/token-store.js'
import type { CliConfig } from '../config/environment.js'
import { isDeveloperTeamId } from '../shared/validation.js'
import { isRecord, readApiResponse } from './response.js'
import type { DeveloperTeam } from './types.js'
import { CLI_VERSION_HEADERS } from './version-header.js'

interface RequestOptions {
  method?: string
  query?: Record<string, string | number | undefined>
  body?: unknown
  headers?: Record<string, string>
  /* Overrides the marketplace base URL, e.g. for oauth-service file uploads. */
  baseUrl?: string
}

const DEVELOPER_TEAM_ROLE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/* Session, headers, request plumbing, and developer-team resolution shared by
   every portal resource. Resource methods are added through the mixins in
   ./resources and composed into ApiClient. */
export class ApiClientCore {
  private profileName = ''

  private profile!: StoredProfile

  private refreshPromise?: Promise<StoredProfile>

  constructor(protected readonly config: CliConfig) {}

  get activeProfileName(): string {
    return this.profileName
  }

  get activeTeamId(): string | undefined {
    return this.profile.teamId
  }

  get activeTeamName(): string | undefined {
    return this.profile.teamName
  }

  async init(): Promise<void> {
    const session = await loadActiveSession(this.config)
    this.profileName = session.name
    this.profile = session.profile
    if (isExpired(this.profile.accessToken, this.profile.expiresAt)) {
      await this.refreshProfile()
    }
  }

  /* Concurrent requests share token rotation so a single-use refresh token
     is never submitted more than once by the same client. */
  private async refreshProfile(): Promise<void> {
    const operation = (this.refreshPromise ??= refreshSession(this.config, this.profileName, this.profile))
    try {
      this.profile = await operation
    } finally {
      if (this.refreshPromise === operation) this.refreshPromise = undefined
    }
  }

  private headers(json = true, additional: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      ...CLI_VERSION_HEADERS,
      authorization: `Bearer ${this.profile.accessToken}`,
      channel: 'APP',
      source: 'DEVELOPER_WEB_USER',
      version: '2023-02-21'
    }
    if (json) headers['content-type'] = 'application/json'
    if (this.profile.teamId) headers.teamid = this.profile.teamId
    return { ...additional, ...headers }
  }

  /* On 401 the token is refreshed once and the request retried;
     a second 401 surfaces as a login error. */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (isExpired(this.profile.accessToken, this.profile.expiresAt)) {
      await this.refreshProfile()
    }
    const url = new URL(`${options.baseUrl ?? this.config.apiUrl}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }

    const isForm = options.body instanceof FormData
    const init = (): { method: string; headers: Record<string, string>; body?: string | FormData } => ({
      method: options.method ?? 'GET',
      headers: this.headers(!isForm, options.headers),
      ...(options.body !== undefined
        ? { body: isForm ? (options.body as FormData) : JSON.stringify(options.body) }
        : {})
    })

    const doFetch = async (): Promise<Response> => {
      try {
        return await fetch(url, init())
      } catch {
        const target = options.baseUrl ?? this.config.apiUrl
        const override =
          target === this.config.oauthUrl
            ? 'GHL_OAUTH_URL'
            : target === this.config.workflowsUrl
              ? 'GHL_WORKFLOWS_URL'
              : 'GHL_API_URL'
        throw new Error(`Cannot reach ${url.origin}. Check your network connection or the ${override} setting.`)
      }
    }

    const requestToken = this.profile.accessToken
    let res = await doFetch()
    if (res.status === 401) {
      if (this.profile.accessToken === requestToken) await this.refreshProfile()
      res = await doFetch()
    }
    if (res.status === 401) throw new Error('Session expired. Run `ghl login` again.')
    return (await readApiResponse(res, {
      failureLabel: 'API request failed',
      responseLabel: 'API request'
    })) as T
  }

  async listDeveloperTeams(): Promise<DeveloperTeam[]> {
    const response = await this.request<unknown>('/users/teams')
    if (!Array.isArray(response)) throw new Error('Developer teams API returned an unexpected response.')
    if (
      !response.every(
        team =>
          isRecord(team) &&
          isDeveloperTeamId(team.team) &&
          (team.name === undefined || typeof team.name === 'string') &&
          (team.role === undefined || (typeof team.role === 'string' && DEVELOPER_TEAM_ROLE.test(team.role)))
      )
    ) {
      throw new Error('Developer teams API returned an unexpected response.')
    }
    return response as DeveloperTeam[]
  }

  async selectDeveloperTeam(teamId: string, memberships?: DeveloperTeam[]): Promise<DeveloperTeam> {
    if (!isDeveloperTeamId(teamId)) {
      throw new Error('Account id must contain 1-128 letters, numbers, underscores, or hyphens.')
    }
    const teams = memberships ?? (await this.listDeveloperTeams())
    const selected = teams.find(membership => membership.team === teamId)
    if (!selected) {
      throw new Error(
        `Account ${JSON.stringify(teamId)} is not available to this developer. Run \`ghl account\` to list accessible accounts.`
      )
    }
    const nextProfile = { ...this.profile, teamId: selected.team }
    if (selected.name) nextProfile.teamName = selected.name
    else delete nextProfile.teamName
    await saveProfile(this.config.configDir, this.profileName, nextProfile)
    this.profile = nextProfile
    return selected
  }

  /* Apps in the portal are owned by the developer's team, so the teamid
     header is resolved once and cached in the profile. */
  async ensureTeam(memberships?: DeveloperTeam[]): Promise<void> {
    if (this.profile.teamId && (!memberships || memberships.some(team => team.team === this.profile.teamId))) return
    const teams = memberships ?? (await this.listDeveloperTeams())
    if (teams.length === 0) {
      throw new Error('No developer account is available. Ask an account owner to add you, then retry.')
    }
    const own = teams.find(membership => membership.role?.toUpperCase() === 'OWNER') ?? teams[0]
    await this.selectDeveloperTeam(own.team, teams)
  }
}

/* Class-expression mixins must accept an any[] rest parameter in their
   constructor constraint; this is the one place the codebase needs `any`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiClientConstructor = new (...args: any[]) => ApiClientCore
