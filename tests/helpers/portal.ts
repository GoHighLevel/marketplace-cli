import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'

import { saveProfile } from '../../src/lib/auth/token-store.js'
import type { CliConfig } from '../../src/lib/config/environment.js'

export const API = 'https://api.test/marketplace'
export const OAUTH = 'https://oauth.test'
export const WORKFLOWS = 'https://workflows.test/workflows-marketplace'

export async function portalConfig(): Promise<CliConfig> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-portal-'))
  return { portalUrl: 'https://portal.test', apiUrl: API, oauthUrl: OAUTH, workflowsUrl: WORKFLOWS, configDir }
}

export function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
}

export async function signIn(config: CliConfig, profile: { teamId?: string; email?: string } = {}): Promise<void> {
  await saveProfile(config.configDir, 'default', {
    accessToken: unsignedJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    refreshToken: 'refresh-token',
    teamId: 'team-1',
    ...profile
  })
}

type Route = unknown | ((init: RequestInit | undefined) => unknown)

export interface PortalResponse {
  status: number
  body: unknown
}

export function portalError(status: number, message: string): PortalResponse {
  return { status, body: { message } }
}

function isPortalResponse(value: unknown): value is PortalResponse {
  return typeof value === 'object' && value !== null && 'status' in value && 'body' in value
}

/* A fetch double keyed by `METHOD url` (query string included). Unrouted
   requests fail loudly so a test never depends on an unexpected call. */
export function routePortal(routes: Record<string, Route>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    if (!Object.hasOwn(routes, key)) throw new Error(`Unrouted request: ${key}`)
    const route = routes[key]
    const value = typeof route === 'function' ? (route as (init: RequestInit | undefined) => unknown)(init) : route
    const { status, body } = isPortalResponse(value) ? value : { status: 200, body: value }
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  })
}

/* Plays the developer's browser: follows the portal's redirect to the local
   login callback with the state from the authorize URL. */
export function approveInBrowser(authorizeUrl: string, code = 'one-time-code'): Promise<number> {
  const url = new URL(authorizeUrl)
  const callback = new URL(`http://127.0.0.1:${url.searchParams.get('port')}/callback`)
  callback.searchParams.set('code', code)
  callback.searchParams.set('state', url.searchParams.get('state') ?? '')
  return new Promise((resolve, reject) => {
    http.get(callback, response => resolve(response.statusCode ?? 0)).on('error', reject)
  })
}
