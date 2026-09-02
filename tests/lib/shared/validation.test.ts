import { describe, expect, it } from 'vitest'

import {
  validateDeprecationDate,
  validateEmail,
  validateHttpUrl,
  validateHttpsUrl,
  validatePhone,
  validatePositiveInteger,
  validateProfileName,
  validateSandboxPassword,
  validateTextForWhiteLabel,
  validateXssSafe,
  validateYouTubeUrl
} from '../../../src/lib/shared/validation.js'

describe('safe text validation', () => {
  it('rejects executable markup and encoded scripts while allowing benign HTML', () => {
    expect(validateXssSafe('<p>Safe product description</p>', 'Description')).toBe(true)
    expect(validateXssSafe('<img src=x onerror=alert(1)>', 'Description')).toMatch(/dangerous/i)
    expect(validateXssSafe('&#x3c;script&#x3e;alert(1)', 'Description')).toMatch(/dangerous/i)
  })

  it('bounds text before applying security regex checks', () => {
    expect(validateXssSafe('x'.repeat(10_001), 'Description')).toMatch(/at most 10,000 characters/i)
  })
})

describe('white-label validation', () => {
  it('blocks GHL brand references using the portal regex', () => {
    expect(validateTextForWhiteLabel('https://ghl.example.com/callback', 'Redirect URI')).toMatch(/white-label/i)
    expect(validateTextForWhiteLabel('HighLevel Pro Plan', 'Plan name')).toMatch(/white-label/i)
    expect(validateTextForWhiteLabel('Go High Level integration', 'Plan feature')).toMatch(/white-label/i)
    expect(validateTextForWhiteLabel('high-level overview', 'Plan feature')).toMatch(/white-label/i)
    expect(validateTextForWhiteLabel('https://acme.com/oauth/callback', 'Redirect URI')).toBe(true)
    expect(validateTextForWhiteLabel('Nightly sync', 'Plan feature')).toBe(true)
  })

  it('bounds text before applying white-label regex checks', () => {
    expect(validateTextForWhiteLabel('x'.repeat(10_001), 'Plan feature')).toMatch(/at most 10,000 characters/i)
  })
})

describe('URL validation', () => {
  it('accepts only complete HTTP(S) URLs with a hostname', () => {
    expect(validateHttpUrl('https://example.com/path', 'Website URL')).toBe(true)
    expect(validateHttpUrl('http://localhost:3000/callback', 'Redirect URI')).toBe(true)
    expect(validateHttpUrl('example.com', 'Website URL')).toMatch(/valid http/i)
    expect(validateHttpUrl('ftp://example.com', 'Website URL')).toMatch(/valid http/i)
    expect(validateHttpUrl('https://user:pass@example.com', 'Website URL')).toMatch(/credentials/i)
  })

  it('requires HTTPS and rejects obvious private webhook targets', () => {
    expect(validateHttpsUrl('https://hooks.example.com/events', 'Webhook URL', { publicOnly: true })).toBe(true)
    expect(validateHttpsUrl('http://hooks.example.com', 'Webhook URL', { publicOnly: true })).toMatch(/https/i)
    expect(validateHttpsUrl('https://127.0.0.1/hook', 'Webhook URL', { publicOnly: true })).toMatch(/public/i)
    expect(validateHttpsUrl('https://169.254.169.254/latest', 'Webhook URL', { publicOnly: true })).toMatch(/public/i)
    expect(validateHttpsUrl('https://svc.default.cluster.local/hook', 'Webhook URL', { publicOnly: true })).toMatch(
      /public/i
    )
    expect(validateHttpsUrl('https://[::ffff:172.16.0.1]/hook', 'Webhook URL', { publicOnly: true })).toMatch(/public/i)
    expect(validateHttpsUrl('https://198.51.100.12/hook', 'Webhook URL', { publicOnly: true })).toMatch(/public/i)
  })

  it('accepts only supported YouTube preview URLs', () => {
    expect(validateYouTubeUrl('https://youtu.be/dQw4w9WgXcQ', 'Preview video URL')).toBe(true)
    expect(validateYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Preview video URL')).toBe(true)
    expect(validateYouTubeUrl('https://vimeo.com/123', 'Preview video URL')).toMatch(/YouTube/i)
    expect(validateYouTubeUrl('http://youtu.be/dQw4w9WgXcQ', 'Preview video URL')).toMatch(/https/i)
    expect(validateYouTubeUrl('https://youtube.example.com/watch?v=dQw4w9WgXcQ', 'Preview video URL')).toMatch(
      /YouTube/i
    )
    expect(validateYouTubeUrl(`https://youtu.be/dQw4w9WgXcQ?${'x'.repeat(2_048)}`, 'Preview video URL')).toMatch(
      /at most 2,048 characters/i
    )
  })
})

describe('contact validation', () => {
  it('validates email and phone values used by support settings', () => {
    expect(validateEmail('support@example.com')).toBe(true)
    expect(validateEmail('not-an-email')).toMatch(/valid email/i)
    expect(validateEmail('support@[192.168.1.1]')).toBe(true)
    expect(validateEmail('support@[999.999.999.999]')).toMatch(/valid email/i)
    expect(validateEmail('.support@example.com')).toMatch(/valid email/i)
    expect(validateEmail(`${'a'.repeat(65)}@example.com`)).toMatch(/valid email/i)
    expect(validateEmail(`${'a'.repeat(245)}@example.com`)).toMatch(/valid email/i)
    expect(validatePhone('+1 (415) 555-2671')).toBe(true)
    expect(validatePhone('++1 415 555 2671')).toMatch(/valid phone/i)
    expect(validatePhone('1 +415 555 2671')).toMatch(/valid phone/i)
    expect(validatePhone('abc')).toMatch(/valid phone/i)
  })
})

describe('numeric and date validation', () => {
  it('enforces positive integer ranges', () => {
    expect(validatePositiveInteger(1, 'Limit', { min: 1, max: 100 })).toBe(true)
    expect(validatePositiveInteger(0, 'Limit', { min: 1, max: 100 })).toMatch(/between 1 and 100/i)
    expect(validatePositiveInteger(101, 'Limit', { min: 1, max: 100 })).toMatch(/between 1 and 100/i)
  })

  it('requires a real deprecation date at least three days in the future', () => {
    const now = new Date('2026-08-10T12:00:00+05:30')
    expect(validateDeprecationDate('2026-08-13', now)).toBe(true)
    expect(validateDeprecationDate('2026-08-12', now)).toMatch(/at least 3 days/i)
    expect(validateDeprecationDate('2026-02-30', now)).toMatch(/valid date/i)
  })
})

describe('local profile validation', () => {
  it('accepts safe profile keys and rejects blank or ambiguous names', () => {
    expect(validateProfileName('work-staging')).toBe(true)
    expect(validateProfileName('')).toMatch(/required/i)
    expect(validateProfileName('__proto__')).toMatch(/letters/i)
    expect(validateProfileName('work profile')).toMatch(/letters/i)
  })
})

describe('sandbox password validation', () => {
  it('enforces the portal rules: length, upper, lower, number, special', () => {
    expect(validateSandboxPassword('MySandbox@Pass1')).toBe(true)
    expect(validateSandboxPassword('Short@1a')).toMatch(/12 characters/i)
    expect(validateSandboxPassword('mysandbox@pass1')).toMatch(/uppercase/i)
    expect(validateSandboxPassword('MYSANDBOX@PASS1')).toMatch(/lowercase/i)
    expect(validateSandboxPassword('MySandbox@Pass')).toMatch(/number/i)
    expect(validateSandboxPassword('MySandboxPass11')).toMatch(/special/i)
  })
})
