import { describe, expect, it } from 'vitest'

import { getJsonSchema } from '../../../src/lib/app/json-schema.js'
import { cliDocEntries, cliDocText, isCliDocUrl, resolveCliDocUrl } from '../../../src/lib/docs/cli-guides.js'
import { buildWorkflowActionsGuide } from '../../../src/lib/workflows/actions/guide.js'

describe('cliDocText', () => {
  it('serves the workspace guides without managed markers, and schemas as compact JSON', () => {
    expect(cliDocText('ghl-cli:workflow-actions')).toBe(buildWorkflowActionsGuide().trim())
    expect(cliDocText('ghl-cli:app')).toMatch(/^# HighLevel Marketplace App\n/)
    expect(cliDocText('ghl-cli:app')).not.toContain('<!--')
    expect(cliDocText('ghl-cli:commands')).toMatch(
      /^# HighLevel CLI command reference\n\n## Complete command reference/
    )
    expect(cliDocText('ghl-cli:schema/webhooks')).toBe(JSON.stringify(getJsonSchema('webhooks')))
  })

  it('returns undefined for unknown topics and other URLs', () => {
    expect(cliDocText('ghl-cli:schema/nope')).toBeUndefined()
    expect(cliDocText('ghl-cli:constructor')).toBeUndefined()
    expect(cliDocText('https://marketplace.gohighlevel.com/docs/x.md')).toBeUndefined()
  })
})

describe('resolveCliDocUrl', () => {
  it('normalizes case and keeps the section anchor', () => {
    expect(isCliDocUrl(' GHL-CLI:Billing')).toBe(true)
    expect(isCliDocUrl('https://marketplace.gohighlevel.com/docs/x.md')).toBe(false)
    expect(resolveCliDocUrl('GHL-CLI:Workflow-Actions#Dynamic-Input')).toEqual({
      url: 'ghl-cli:workflow-actions',
      anchor: 'dynamic-input'
    })
    expect(resolveCliDocUrl('ghl-cli:schema/app')).toEqual({ url: 'ghl-cli:schema/app' })
  })

  it('lists the available references for an unknown one', () => {
    expect(() => resolveCliDocUrl('ghl-cli:nope')).toThrow(
      expect.objectContaining({
        code: 'DOC_NOT_FOUND',
        message: expect.stringMatching(/Available: app, .*schema\/usage-based\.$/)
      })
    )
  })
})

describe('cliDocEntries', () => {
  it('indexes every guide section and every schema as CLI entries', () => {
    const entries = cliDocEntries()
    expect(entries.every(entry => entry.kind === 'cli' && entry.url.startsWith('ghl-cli:'))).toBe(true)
    expect(entries).toContainEqual(
      expect.objectContaining({
        title: 'HighLevel Workflow Actions › Dynamic input',
        url: 'ghl-cli:workflow-actions#dynamic-input'
      })
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        title: 'JSON Schema: HighLevel Webhook Manifest (src/webhooks/ghl-webhooks.json)',
        url: 'ghl-cli:schema/webhooks',
        text: expect.stringContaining('Top-level keys: schemaVersion, appId, versionId, webhookUrl, subscribedEvents.')
      })
    )
  })
})
