import { exchangeCodeForTokens, storedProfileFromTokenResponse } from '../api/token-exchange.js'
import type { CliConfig } from '../config/environment.js'
import { startLoopbackServer } from './loopback.js'
import { generatePkcePair, generateState } from './pkce.js'
import { saveProfile } from './token-store.js'

export interface AuthorizeUrlOptions {
  challenge: string
  state: string
  port: number
}

export interface BrowserLogin {
  /* The portal page that asks the developer to approve this login. */
  url: string
  /* Resolves with the one-time code once the developer approves. */
  approval: Promise<string>
  /* Exchanges the approved code and stores the session; resolves with the
     developer's email, name, or id when the portal returns one. */
  signIn: (code: string) => Promise<string | undefined>
  close: () => void
}

export function buildAuthorizeUrl(portalUrl: string, options: AuthorizeUrlOptions): URL {
  const authorizeUrl = new URL('/cli-auth', portalUrl)
  authorizeUrl.searchParams.set('challenge', options.challenge)
  authorizeUrl.searchParams.set('state', options.state)
  authorizeUrl.searchParams.set('port', String(options.port))
  return authorizeUrl
}

/* PKCE browser login: a 127.0.0.1 callback receives the one-time code, and
   only this process holds the verifier needed to exchange it. */
export interface BrowserLoginOptions {
  timeoutMs?: number
  /* False for a background login in a long-running server, which must still
     exit when its client disconnects. */
  keepProcessAlive?: boolean
}

export async function startBrowserLogin(
  config: CliConfig,
  profileName: string,
  options: BrowserLoginOptions = {}
): Promise<BrowserLogin> {
  const { verifier, challenge } = generatePkcePair()
  const state = generateState()
  const server = await startLoopbackServer(state, options.timeoutMs, options.keepProcessAlive)
  return {
    url: buildAuthorizeUrl(config.portalUrl, { challenge, state, port: server.port }).href,
    approval: server.waitForCode,
    signIn: async code => {
      const tokens = await exchangeCodeForTokens(config.apiUrl, code, verifier)
      await saveProfile(config.configDir, profileName, storedProfileFromTokenResponse(tokens))
      return tokens.developer?.email ?? tokens.developer?.name ?? tokens.developer?.id
    },
    close: server.close
  }
}
