import { describe, expect, it } from 'vitest'

import { AppVersion } from '../../../src/lib/api/client.js'
import {
  buildBasicInfoBody,
  buildListingBody,
  buildProfilesBody,
  buildReviewDetailsBody,
  buildSupportBody,
  currentInstaller,
  currentTarget,
  extractNewVersion,
  validateBasicInfoBody,
  validateDemoUrl,
  validateProfilesBody,
  validateReviewDetailsBody,
  validateReviewDetailsChanges,
  validateStoredReviewDetails,
  validateSupportBody
} from '../../../src/lib/app/profile-sections.js'

const version: AppVersion = {
  _id: 'v1',
  appId: 'a1',
  name: 'My App',
  private: false,
  tagline: 'A useful old tagline',
  companyName: 'Acme',
  website: 'https://acme.com',
  subcategory: ['crm'],
  businessNiche: ['dental'],
  logoUrl: 'https://cdn/logo.png',
  userTypes: ['Location'],
  isWhiteLabelFriendly: true,
  searchKeywords: ['old'],
  description: 'Agency description',
  previewImageUrls: ['https://cdn/1.png'],
  hasSubAccountProfile: false,
  supportConfig: { supportEmail: 'a@b.co' }
}

describe('buildBasicInfoBody', () => {
  it('merges changes over current values and keeps the rest', () => {
    const body = buildBasicInfoBody(version, { tagline: 'New tagline' })
    expect(body.tagline).toBe('New tagline')
    expect(body.name).toBe('My App')
    expect(body.companyName).toBe('Acme')
    expect(body.private).toBe(false)
  })

  it('reports portal validation failures before an API request', () => {
    expect(validateBasicInfoBody(buildBasicInfoBody(version, { tagline: 'short' }))).toMatch(/20 characters/i)
    expect(validateBasicInfoBody(buildBasicInfoBody(version, { companyName: '' }))).toMatch(/Company name is required/i)
    expect(validateBasicInfoBody(buildBasicInfoBody(version, { website: 'example.com' }))).toMatch(/valid https/i)
    expect(validateBasicInfoBody(buildBasicInfoBody(version, { logoUrl: 'https://cdn/logo.exe' }))).toMatch(/\.png/i)
    expect(validateBasicInfoBody(buildBasicInfoBody(version, { name: '<script>alert(1)</script>' }))).toMatch(
      /dangerous/i
    )
    expect(
      validateBasicInfoBody(buildBasicInfoBody(version, { tagline: 'A useful scheduling tagline', companyName: 'Acme' }))
    ).toBe(true)
    expect(
      validateBasicInfoBody(buildBasicInfoBody(version, { companyName: 'HighLevel Partner' }), true)
    ).toMatch(/white-label/i)
    expect(
      validateBasicInfoBody(buildBasicInfoBody(version, { website: 'https://ghl.example.com' }), true)
    ).toMatch(/white-label/i)
    expect(
      validateBasicInfoBody(buildBasicInfoBody(version, { companyName: 'HighLevel Partner' }), false)
    ).toBe(true)
  })

  it('uses the portal template payload and skips standard-only requirements', () => {
    const body = buildBasicInfoBody(
      { _id: 'template-v1', appType: 'template', companyName: 'Acme', website: 'https://acme.com' },
      {}
    )
    expect(body).toEqual({ private: false, companyName: 'Acme', website: 'https://acme.com', appType: 'template' })
    expect(validateBasicInfoBody(body)).toBe(true)
  })
})

describe('target/installer derivation', () => {
  it('derives sub-account + everyone from Location only', () => {
    expect(currentTarget({ _id: 'x', userTypes: ['Location'] })).toBe('sub-account')
    expect(currentInstaller({ _id: 'x', userTypes: ['Location'] })).toBe('everyone')
  })

  it('derives agency-only from Location + Company, agency from Company only', () => {
    expect(currentInstaller({ _id: 'x', userTypes: ['Location', 'Company'] })).toBe('agency-only')
    expect(currentTarget({ _id: 'x', userTypes: ['Company'] })).toBe('agency')
  })
})

describe('buildListingBody', () => {
  it('keeps current userTypes when only keywords change', () => {
    const body = buildListingBody(version, { keywords: ['new'] })
    expect(body.userTypes).toEqual(['Location'])
    expect(body.searchKeywords).toEqual(['new'])
  })

  it('recomputes userTypes when target changes to agency', () => {
    const body = buildListingBody({ ...version, isAgencyBulkInstallEnabled: true }, { target: 'agency' })
    expect(body.userTypes).toEqual(['Company'])
    expect(body.isAgencyBulkInstallEnabled).toBe(false)
  })

  it('enables bulk install when only agencies can install', () => {
    const body = buildListingBody({ ...version, isAgencyBulkInstallEnabled: false }, { installer: 'agency-only' })
    expect(body.userTypes).toEqual(['Location', 'Company'])
    expect(body.isAgencyBulkInstallEnabled).toBe(true)
  })

  it('preserves the bulk-install choice for sub-account apps open to everyone', () => {
    expect(
      buildListingBody({ ...version, isAgencyBulkInstallEnabled: false }, {}).isAgencyBulkInstallEnabled
    ).toBe(false)
  })

  it('rejects installer changes on agency-target apps', () => {
    expect(() => buildListingBody(version, { target: 'agency', installer: 'agency-only' })).toThrow(/sub-account/)
  })

  it('maps listing type to isWhiteLabelFriendly', () => {
    expect(buildListingBody(version, { listing: 'standard' }).isWhiteLabelFriendly).toBe(false)
    expect(buildListingBody(version, {}).isWhiteLabelFriendly).toBe(true)
  })

  it('converts between private and public via the type change', () => {
    expect(buildListingBody({ ...version, private: true }, { type: 'public' }).private).toBe(false)
    expect(buildListingBody(version, { type: 'private' }).private).toBe(true)
    expect(buildListingBody({ ...version, private: true }, {}).private).toBe(true)
  })
})

describe('buildReviewDetailsBody', () => {
  it('merges changes over stored values for public apps', () => {
    const body = buildReviewDetailsBody(
      { ...version, endToEndDemoUrl: 'https://old.demo', testCredentials: 'user/pass' },
      { scopesDemoUrl: 'https://new.scopes' }
    )
    expect(body.endToEndDemoUrl).toBe('https://old.demo')
    expect(body.scopesDemoUrl).toBe('https://new.scopes')
    expect(body.testCredentials).toBe('user/pass')
    expect('bypassDraft' in body).toBe(false)
  })

  it('adds bypassDraft + private for private apps, like the portal', () => {
    const body = buildReviewDetailsBody({ ...version, private: true }, { privateReason: 'internal tool' })
    expect(body).toMatchObject({ bypassDraft: true, private: true, privateReason: 'internal tool' })
  })
})

describe('validateDemoUrl', () => {
  it('accepts only valid https URLs', () => {
    expect(validateDemoUrl('https://youtu.be/abc')).toBe(true)
    expect(validateDemoUrl('http://youtu.be/abc')).not.toBe(true)
    expect(validateDemoUrl('not-a-url')).not.toBe(true)
  })
})

describe('buildProfilesBody', () => {
  it('replaces only the provided screenshot list', () => {
    const body = buildProfilesBody(version, { previewImageUrls: ['https://cdn/1.png', 'https://cdn/2.png'] })
    expect(body.previewImageUrls).toHaveLength(2)
    expect(body.description).toBe('Agency description')
  })

  it('validates descriptions, YouTube URLs, and enabled sub-account details', () => {
    expect(validateProfilesBody(buildProfilesBody(version, { previewVideoUrl: 'https://vimeo.com/1' }))).toMatch(
      /YouTube/i
    )
    expect(
      validateProfilesBody(
        buildProfilesBody(
          { ...version, description: 'x'.repeat(300) },
          { previewVideoUrl: 'https://youtu.be/dQw4w9WgXcQ' }
        )
      )
    ).toBe(true)
    expect(
      validateProfilesBody(
        buildProfilesBody(
          { ...version, description: 'x'.repeat(300) },
          { hasSubAccountProfile: true, subAccountDescription: 'x'.repeat(300), subAccountPreviewImageUrls: [] }
        )
      )
    ).toMatch(/at least 3 screenshots/i)
    expect(
      validateProfilesBody(
        buildProfilesBody(
          { ...version, description: 'x'.repeat(300) },
          { previewImageUrls: ['https://cdn.example.com/screenshot.txt'] }
        )
      )
    ).toMatch(/\.png/i)
  })

  it('clears sub-account-only fields when the profile is disabled', () => {
    const body = buildProfilesBody(
      {
        ...version,
        hasSubAccountProfile: true,
        subAccountDescription: 'x'.repeat(300),
        subAccountPreviewImageUrls: ['one', 'two', 'three'],
        subAccountPreviewVideoUrl: 'https://youtu.be/dQw4w9WgXcQ'
      },
      { hasSubAccountProfile: false }
    )
    expect(body).toMatchObject({
      hasSubAccountProfile: false,
      subAccountDescription: '',
      subAccountPreviewImageUrls: [],
      subAccountPreviewVideoUrl: ''
    })
  })
})

describe('buildSupportBody', () => {
  it('merges support fields into the full supportConfig', () => {
    const body = buildSupportBody(version, { supportPhone: '+123' })
    expect(body.supportConfig.supportEmail).toBe('a@b.co')
    expect(body.supportConfig.supportPhone).toBe('+123')

    const withServices = buildSupportBody(version, { supportedServices: ['bug_assistance'] })
    expect(withServices.supportConfig.supportedServices).toEqual(['bug_assistance'])
  })

  it('validates the final merged support contact and URLs', () => {
    expect(validateSupportBody(buildSupportBody(version, { supportEmail: 'bad' }))).toMatch(/valid email/i)
    expect(
      validateSupportBody(
        buildSupportBody({ ...version, supportConfig: {} }, { supportEmail: '', supportPhone: '' })
      )
    ).toMatch(/email or support phone/i)
    const normalized = buildSupportBody(version, { documentationUrl: 'docs.example.com' })
    expect(validateSupportBody(normalized)).toBe(true)
    expect(normalized.supportConfig.documentationUrl).toBe('https://docs.example.com')
    expect(validateSupportBody(buildSupportBody(version, { documentationUrl: 'http://docs.example.com' }))).toMatch(
      /valid https/i
    )
    expect(validateSupportBody(buildSupportBody(version, { supportedServices: [] }), true)).toMatch(
      /supported service/i
    )
    expect(
      validateSupportBody(buildSupportBody(version, { supportedServices: ['unknown'] }), true)
    ).toMatch(/unknown supported service/i)
  })
})

describe('validateReviewDetailsBody', () => {
  it('requires both HTTPS demo URLs and a reason for private apps', () => {
    expect(validateReviewDetailsBody(buildReviewDetailsBody(version, {}), false)).toMatch(/End-to-end demo URL is required/i)
    const publicBody = buildReviewDetailsBody(version, {
      demoUrl: 'https://example.com/demo',
      scopesDemoUrl: 'https://example.com/scopes'
    })
    expect(validateReviewDetailsBody(publicBody, false)).toBe(true)
    expect(validateReviewDetailsBody({ ...publicBody, privateReason: '' }, true)).toMatch(/reason is required/i)
  })

  it('enforces the text limits shown by the review-details form', () => {
    const body = buildReviewDetailsBody(
      { ...version, private: true },
      {
        demoUrl: 'https://example.com/demo',
        scopesDemoUrl: 'https://example.com/scopes',
        privateReason: 'reason',
        testCredentials: 'x'.repeat(201)
      }
    )
    expect(validateReviewDetailsChanges({ testCredentials: body.testCredentials })).toMatch(/credentials.*200/i)
    expect(validateReviewDetailsChanges({ notes: 'x'.repeat(501) })).toMatch(
      /additional details.*500/i
    )
    expect(validateReviewDetailsChanges({ privateReason: 'x'.repeat(501) })).toMatch(
      /reason.*500/i
    )
    expect(validateReviewDetailsBody(body, true)).toBe(true)
  })

  it('validates stored details while allowing template apps to skip them', () => {
    expect(validateStoredReviewDetails({ _id: 'v1', private: false }, false)).toMatch(/demo URL is required/i)
    expect(validateStoredReviewDetails({ _id: 'v1', appType: 'template' }, false)).toBe(true)
    expect(
      validateStoredReviewDetails(
        {
          _id: 'v1',
          private: true,
          endToEndDemoUrl: 'https://example.com/demo',
          scopesDemoUrl: 'https://example.com/scopes',
          privateReason: ''
        },
        true
      )
    ).toMatch(/reason is required/i)
  })
})

describe('validateDescription', () => {
  it('enforces the portal 300-5000 plain-text length, stripping HTML', async () => {
    const { validateDescription } = await import('../../../src/lib/app/profile-sections.js')
    expect(validateDescription('too short')).toMatch(/at least 300/)
    expect(validateDescription(`<p>${'x'.repeat(300)}</p>`)).toBe(true)
    expect(validateDescription(`<b>${'x'.repeat(200)}</b>`)).toMatch(/at least 300/)
    expect(validateDescription('x'.repeat(5001))).toMatch(/at most 5000/)
  })
})

describe('extractNewVersion', () => {
  it('reads ids from oAuthClient or pendingOAuthClient', () => {
    expect(extractNewVersion({ oAuthClient: { _id: 'v2', appId: 'a1' } })).toEqual({ appId: 'a1', versionId: 'v2' })
    expect(extractNewVersion({ pendingOAuthClient: { id: 'v3' } })).toEqual({ appId: undefined, versionId: 'v3' })
    expect(extractNewVersion({})).toEqual({})
  })
})
