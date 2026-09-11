import { describe, expect, it } from 'vitest'

import { type AppVersion } from '../../../src/lib/api/client.js'
import { buildAppFiles } from '../../../src/lib/app/manifest.js'

const omittedCredential = ['must-never', 'be-exported'].join('-')

const version: AppVersion = {
  _id: 'version-1',
  appId: 'app-1',
  createdAt: '2026-06-17T00:00:00.000Z',
  version: '1.2.0',
  status: 'draft',
  appType: 'standard',
  name: 'Acme CRM',
  private: false,
  tagline: 'Keep every customer conversation organized',
  companyName: 'Acme',
  contact: { name: 'Support', email: 'support@acme.test' },
  website: 'https://acme.test',
  category: 'CRM',
  subcategory: ['Sales'],
  businessNiche: ['Automotive'],
  logoUrl: 'https://cdn.acme.test/logo.png',
  userTypes: ['Location', 'Company'],
  isWhiteLabelFriendly: true,
  isAgencyBulkInstallEnabled: true,
  searchKeywords: ['crm', 'sales'],
  description: 'Agency profile',
  previewImageUrls: ['https://cdn.acme.test/agency.png'],
  previewVideoUrl: 'https://youtube.com/watch?v=agency',
  hasSubAccountProfile: true,
  subAccountDescription: 'Sub-account profile',
  subAccountPreviewImageUrls: ['https://cdn.acme.test/location.png'],
  subAccountPreviewVideoUrl: 'https://youtube.com/watch?v=location',
  supportConfig: {
    supportEmail: 'help@acme.test',
    documentationUrl: 'https://docs.acme.test',
    supportedServices: ['technical_questions']
  },
  allowedScopes: ['contacts.readonly'],
  redirectUris: ['https://acme.test/oauth/callback'],
  clientKeys: [
    {
      id: 'client-id',
      name: 'Production',
      deleted: false,
      isDefault: true,
      secret: omittedCredential
    }
  ],
  defaults: { clientKey: 'client-id', redirectUrl: 'https://acme.test/oauth/callback' },
  webhookUrl: 'https://acme.test/webhooks',
  subscribedEvents: [{ name: 'ContactCreate', url: 'https://acme.test/contact-created', warningFlag: true }],
  hasExternalAuth: true,
  externalAuthConfig: {
    type: 'oauth2',
    fields: [
      { key: 'region', type: 'text', defaultValue: 'us-east-1', required: true },
      { key: 'password', type: 'password', defaultValue: 'password-value', required: true }
    ],
    requestConfig: {
      url: 'https://url-user:url-password@api.acme.test/me?api_key=query-secret&access_token=query-token&region=us#access_token=fragment-secret',
      method: 'GET',
      headers: [
        { key: 'Authorization', value: 'Bearer header-secret' },
        { key: 'Accept', value: 'application/json' }
      ],
      body: [{ key: 'password', value: 'body-secret' }]
    },
    tokenManagement: {
      name: 'Acme',
      clientId: 'public-client-id',
      clientSecret: 'external-client-secret',
      accessTokenConfig: { body: [{ key: 'client_secret', value: 'nested-secret' }] },
      pkceEnabled: true
    }
  },
  externalConfig: { name: 'Acme auth', verificationUrl: 'https://acme.test/verify' },
  mcpConfig: {
    mcpUrl: 'https://acme.test/mcp',
    publicMCP: true,
    developerPreviewTools: [
      {
        name: 'find_contact',
        enabled: true,
        inputSchema: { type: 'object', properties: { password: { type: 'string' } } }
      }
    ]
  },
  customPages: [
    {
      title: 'Dashboard',
      liveUrl: 'https://acme.test/dashboard',
      testingUrl: 'https://staging.acme.test/dashboard',
      mountPosition: 'dashboard',
      icon: { name: 'chart' },
      isGettingStartedGuide: false,
      visibleOn: 'both',
      allowCamera: false,
      allowMicrophone: true
    }
  ],
  billingType: 'paid',
  isPaidApp: true,
  isFreemium: false,
  externalBilling: false,
  hasFreeTrial: true,
  freeTrialDuration: 14,
  hasUsageBasedPrice: true,
  paymentType: 'recurring',
  oneTimePrice: 99,
  additionalInfoForBilling: 'Includes priority support',
  endToEndDemoUrl: 'https://youtube.com/watch?v=e2e',
  scopesDemoUrl: 'https://youtube.com/watch?v=scopes',
  testCredentials: 'username: demo\npassword: review-secret',
  additionalDetails: 'Review notes',
  privateReason: 'Internal use',
  ssoKey: 'masked-or-real-sso-key'
}

describe('buildAppFiles', () => {
  it('maps every editable app section without expanding billing plans', () => {
    const { app } = buildAppFiles(version)

    expect(app).toMatchObject({
      schemaVersion: 1,
      appId: 'app-1',
      versionId: 'version-1',
      createdAt: '2026-06-17T00:00:00.000Z',
      version: '1.2.0',
      status: 'draft',
      appType: 'standard',
      basicInfo: {
        name: 'Acme CRM',
        tagline: 'Keep every customer conversation organized',
        companyName: 'Acme',
        contact: { name: 'Support', email: 'support@acme.test' },
        website: 'https://acme.test',
        category: 'CRM',
        subcategory: ['Sales'],
        businessNiche: ['Automotive'],
        logoUrl: 'https://cdn.acme.test/logo.png'
      },
      listing: {
        private: false,
        userTypes: ['Location', 'Company'],
        isWhiteLabelFriendly: true,
        isAgencyBulkInstallEnabled: true,
        searchKeywords: ['crm', 'sales']
      },
      profiles: {
        agency: {
          description: 'Agency profile',
          previewImageUrls: ['https://cdn.acme.test/agency.png'],
          previewVideoUrl: 'https://youtube.com/watch?v=agency'
        },
        subAccount: {
          enabled: true,
          description: 'Sub-account profile',
          previewImageUrls: ['https://cdn.acme.test/location.png'],
          previewVideoUrl: 'https://youtube.com/watch?v=location'
        }
      },
      oauth: {
        allowedScopes: ['contacts.readonly'],
        redirectUris: ['https://acme.test/oauth/callback'],
        defaults: { clientKey: 'client-id', redirectUrl: 'https://acme.test/oauth/callback' },
        clientKeys: [{ id: 'client-id', name: 'Production', isDefault: true }]
      },
      supportConfig: {
        supportEmail: 'help@acme.test',
        supportPhone: '',
        websiteUrl: '',
        documentationUrl: 'https://docs.acme.test',
        termsAndConditionsUrl: '',
        privacyPolicyUrl: '',
        supportedServices: ['technical_questions']
      },
      billing: {
        billingType: 'paid',
        isPaidApp: true,
        isFreemium: false,
        externalBilling: false,
        externalBillingUrl: '',
        hasFreeTrial: true,
        freeTrialDuration: 14,
        hasUsageBasedPrice: true,
        paymentType: 'recurring',
        oneTimePrice: 99,
        additionalInfoForBilling: 'Includes priority support'
      },
      review: {
        endToEndDemoUrl: 'https://youtube.com/watch?v=e2e',
        scopesDemoUrl: 'https://youtube.com/watch?v=scopes',
        additionalDetails: 'Review notes',
        privateReason: 'Internal use'
      }
    })
    expect(app).not.toHaveProperty('externalConfig')
    expect(app).not.toHaveProperty('mcpConfig')
    expect(app).not.toHaveProperty('customPages')
    expect(app.oauth).not.toHaveProperty('hasExternalAuth')
    expect(app.oauth).not.toHaveProperty('externalAuthConfig')
    expect(app.billing).not.toHaveProperty('plans')
  })

  it('keeps webhooks in a separate file and omits server warning state', () => {
    const { app, webhooks } = buildAppFiles(version)

    expect(JSON.stringify(app)).not.toMatch(/webhookUrl|subscribedEvents|ContactCreate/)
    expect(webhooks).toEqual({
      schemaVersion: 1,
      appId: 'app-1',
      versionId: 'version-1',
      webhookUrl: 'https://acme.test/webhooks',
      subscribedEvents: [{ name: 'ContactCreate', url: 'https://acme.test/contact-created' }]
    })
  })

  it('never serializes credentials or excluded configuration sections', () => {
    const files = buildAppFiles(version)
    const serialized = JSON.stringify(files)

    for (const secret of [
      'must-never-be-exported',
      'review-secret',
      'masked-or-real-sso-key',
      'password-value',
      'url-user',
      'url-password',
      'query-secret',
      'query-token',
      'fragment-secret',
      'header-secret',
      'body-secret',
      'external-client-secret',
      'nested-secret'
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(serialized).not.toMatch(
      /testCredentials|ssoKey|clientSecret|accessTokenConfig|externalAuthConfig|externalConfig|mcpConfig|customPages/
    )
  })

  it('creates a complete editable scaffold when the API omits optional values', () => {
    const { app, webhooks } = buildAppFiles({ _id: 'version-2', appId: 'app-2', name: 'New App' })

    expect(app.basicInfo).toEqual({
      name: 'New App',
      tagline: '',
      companyName: '',
      contact: { name: '', email: '' },
      website: '',
      category: '',
      subcategory: [],
      businessNiche: [],
      logoUrl: ''
    })
    expect(app.oauth).toMatchObject({
      allowedScopes: [],
      redirectUris: [],
      clientKeys: []
    })
    expect(app.review).toEqual({
      endToEndDemoUrl: '',
      scopesDemoUrl: '',
      additionalDetails: '',
      privateReason: ''
    })
    expect(webhooks).toMatchObject({ webhookUrl: '', subscribedEvents: [] })
  })

  it('ignores excluded configuration regardless of its shape', () => {
    const externalAuthConfig: Record<string, unknown> = {}
    let cursor = externalAuthConfig
    for (let depth = 0; depth < 60; depth += 1) {
      const next: Record<string, unknown> = {}
      cursor.next = next
      cursor = next
    }

    const { app } = buildAppFiles({
      _id: 'version-3',
      appId: 'app-3',
      externalAuthConfig,
      externalConfig: { enabled: true },
      mcpConfig: { mcpUrl: 'https://example.com/mcp' },
      customPages: [{ title: 'Dashboard' }]
    })

    expect(app).not.toHaveProperty('externalConfig')
    expect(app).not.toHaveProperty('mcpConfig')
    expect(app).not.toHaveProperty('customPages')
    expect(app.oauth).not.toHaveProperty('externalAuthConfig')
  })
})
