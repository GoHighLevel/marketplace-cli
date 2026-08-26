import os from 'node:os'
import path from 'node:path'

import { validateHttpUrl } from '../shared/validation.js'

export interface CliConfig {
  portalUrl: string
  apiUrl: string
  oauthUrl: string
  workflowsUrl: string
  configDir: string
}

/* Staging defaults so an npm install works out of the box; the env vars
   documented in the README override them to target another environment. */
const DEFAULT_PORTAL_URL = 'https://staging.marketplace.gohighlevel.com'
const DEFAULT_API_URL = 'https://staging.backend.leadconnectorhq.com/marketplace'
const DEFAULT_OAUTH_URL = 'https://staging.backend.leadconnectorhq.com/oauth'
const DEFAULT_WORKFLOWS_URL = 'https://staging.backend.leadconnectorhq.com/workflows-marketplace'

export function getConfig(): CliConfig {
  const valueFor = (name: string, fallback: string): string => {
    const value = process.env[name] ?? fallback
    const validation = validateHttpUrl(value, name)
    if (validation !== true) throw new Error(validation)
    return value.replace(/\/+$/, '')
  }
  const configDir = process.env.GHL_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'ghl')
  if (!configDir.trim()) throw new Error('GHL_CONFIG_DIR cannot be blank.')
  return {
    portalUrl: valueFor('GHL_PORTAL_URL', DEFAULT_PORTAL_URL),
    apiUrl: valueFor('GHL_API_URL', DEFAULT_API_URL),
    oauthUrl: valueFor('GHL_OAUTH_URL', DEFAULT_OAUTH_URL),
    workflowsUrl: valueFor('GHL_WORKFLOWS_URL', DEFAULT_WORKFLOWS_URL),
    configDir
  }
}
