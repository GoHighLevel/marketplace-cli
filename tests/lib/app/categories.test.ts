import { describe, expect, it } from 'vitest'

import {
  BUSINESS_NICHE_VALUES,
  normalizeBusinessNiches,
  normalizeKeywords,
  normalizeSubcategories,
  SUBCATEGORY_VALUES
} from '../../../src/lib/app/categories.js'

describe('normalizeSubcategories', () => {
  it('lowercases and validates known categories', () => {
    expect(normalizeSubcategories('CRM, Email')).toEqual(['crm', 'email'])
  })

  it('returns an error message for unknown categories', () => {
    expect(normalizeSubcategories('not-a-category')).toMatch(/Unknown category/)
  })

  it('requires one to three unique categories', () => {
    expect(normalizeSubcategories('')).toMatch(/at least one/i)
    expect(normalizeSubcategories('crm,email,sms,seo')).toMatch(/at most 3/i)
    expect(normalizeSubcategories('CRM, crm')).toEqual(['crm'])
  })

  it('exposes the flat portal category list', () => {
    expect(SUBCATEGORY_VALUES).toContain('crm')
    expect(SUBCATEGORY_VALUES).toContain('other')
    expect(SUBCATEGORY_VALUES).toContain('payment provider')
  })
})

describe('normalizeBusinessNiches', () => {
  it('normalizes portal values and rejects unknown or excessive values', () => {
    expect(normalizeBusinessNiches('Dental, Marketing Agency')).toEqual(['dental', 'marketing agency'])
    expect(BUSINESS_NICHE_VALUES).toContain('real estate')
    expect(normalizeBusinessNiches('unknown')).toMatch(/Unknown business niche/i)
    expect(normalizeBusinessNiches('dental,legal,retail,solar')).toMatch(/at most 3/i)
  })
})

describe('normalizeKeywords', () => {
  it('trims and de-duplicates case-insensitively', () => {
    expect(normalizeKeywords(' CRM,crm, Automation ')).toEqual(['CRM', 'Automation'])
  })

  it('enforces the portal 200-character total', () => {
    expect(normalizeKeywords(`${'a'.repeat(150)},${'b'.repeat(51)}`)).toMatch(/200 characters/i)
  })
})
