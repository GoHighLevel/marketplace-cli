import { afterEach, describe, expect, it, vi } from 'vitest'

import { getConfig } from '../../../src/lib/config/environment.js'

afterEach(() => vi.unstubAllEnvs())

describe('getConfig', () => {
  it('validates environment URLs and removes trailing slashes', () => {
    vi.stubEnv('GHL_API_URL', 'https://api.example.com/marketplace/')
    vi.stubEnv('GHL_WORKFLOWS_URL', 'https://api.example.com/workflows-marketplace/')
    expect(getConfig().apiUrl).toBe('https://api.example.com/marketplace')
    expect(getConfig().workflowsUrl).toBe('https://api.example.com/workflows-marketplace')

    vi.stubEnv('GHL_API_URL', 'api.example.com')
    expect(() => getConfig()).toThrow(/GHL_API_URL.*valid http/i)
  })

  it('rejects a blank config directory override', () => {
    vi.stubEnv('GHL_CONFIG_DIR', '   ')
    expect(() => getConfig()).toThrow(/GHL_CONFIG_DIR.*cannot be blank/i)
  })
})
