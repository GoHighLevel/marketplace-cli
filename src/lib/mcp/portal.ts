import { ApiClient } from '../api/client.js'
import type { CliConfig } from '../config/environment.js'
import { CodedError } from '../shared/errors.js'

/* A signed-in portal client per tool call. Credentials are read afresh each
   time, so a `ghl login` or account switch made in a terminal applies to the
   next call of a long-running server. */
export async function portalClient(config: CliConfig): Promise<ApiClient> {
  const client = new ApiClient(config)
  await client.init()
  return client
}

/* Resolves to undefined instead of failing when nobody is logged in, for
   tools that still help without a session; other failures still throw. */
export async function whenLoggedIn<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read
  } catch (error) {
    if (error instanceof CodedError && error.code === 'AUTH_REQUIRED') return undefined
    throw error
  }
}
