import { describe, expect, it } from 'vitest'

import {
  formatReadinessError,
  requireSecurityReviewEligible,
  requireVersionStatus,
  requiresPublicReviewDetails
} from '../../../src/lib/app/rules.js'

describe('version action rules', () => {
  it('accepts allowed statuses and reports actionable mismatches', () => {
    expect(() => requireVersionStatus('draft', ['draft', 'disapproved'], 'publish')).not.toThrow()
    expect(() => requireVersionStatus('live', ['draft', 'disapproved'], 'publish')).toThrow(
      /publish.*draft or disapproved.*currently live/i
    )
    expect(() => requireVersionStatus(undefined, ['live'], 'deprecate')).toThrow(/status is unavailable/i)
    expect(() => requireVersionStatus('in_review', ['inReview'], 'withdraw')).not.toThrow()
  })
})

describe('public review details rules', () => {
  it('requires details only for non-template public apps', () => {
    expect(requiresPublicReviewDetails({ private: false })).toBe(true)
    expect(requiresPublicReviewDetails({ private: false, appType: 'template' })).toBe(false)
    expect(requiresPublicReviewDetails({ private: true })).toBe(false)
  })
})

describe('formatReadinessError', () => {
  it('keeps the API reason while listing failed checklist fields and a fix command', () => {
    expect(
      formatReadinessError({
        success: false,
        message: 'Complete the required fields.',
        mandatoryFields: { name: true, logo: false, scopes: false }
      })
    ).toBe('Complete the required fields. Missing: logo, scopes. Run `ghl app validate --remote` for fix commands.')
  })
})

describe('security review rules', () => {
  it('enforces the portal eligibility conditions', () => {
    const eligible = { private: true, status: 'live', securityReview: {} }
    expect(() => requireSecurityReviewEligible(eligible, 4)).not.toThrow()
    expect(() => requireSecurityReviewEligible(eligible, 3)).toThrow(/four qualifying agency installs/i)
    expect(() => requireSecurityReviewEligible({ ...eligible, private: false }, 4)).toThrow(/private apps/i)
    expect(() =>
      requireSecurityReviewEligible({ ...eligible, securityReview: { status: 'inReview' } }, 4)
    ).toThrow(/already in progress/i)
    expect(() =>
      requireSecurityReviewEligible({ ...eligible, securityReview: { status: 'in-review' } }, 4)
    ).toThrow(/already in progress/i)
  })
})
