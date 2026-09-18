import type { AppVersion } from '../../src/lib/api/types.js'
import { type AppFiles, buildAppFiles } from '../../src/lib/app/manifest.js'

const DESCRIPTION = 'A'.repeat(320)
const SUB_ACCOUNT_DESCRIPTION = 'B'.repeat(320)

export function completeAppVersion(overrides: Partial<AppVersion> = {}): AppVersion {
  return {
    _id: 'version-1',
    appId: 'app-1',
    version: '1.0.0',
    status: 'draft',
    appType: 'standard',
    name: 'Acme CRM',
    private: false,
    tagline: 'Keep every customer conversation organized',
    companyName: 'Acme',
    website: 'https://acme.example.com',
    category: '',
    subcategory: ['crm'],
    businessNiche: ['car dealership'],
    logoUrl: 'https://cdn.acme.example.com/logo.png',
    userTypes: ['Location'],
    isWhiteLabelFriendly: false,
    isAgencyBulkInstallEnabled: false,
    searchKeywords: ['crm', 'contacts'],
    description: DESCRIPTION,
    previewImageUrls: [
      'https://cdn.acme.example.com/agency-1.png',
      'https://cdn.acme.example.com/agency-2.png',
      'https://cdn.acme.example.com/agency-3.png'
    ],
    previewVideoUrl: 'https://youtu.be/abcdefghijk',
    hasSubAccountProfile: true,
    subAccountDescription: SUB_ACCOUNT_DESCRIPTION,
    subAccountPreviewImageUrls: [
      'https://cdn.acme.example.com/location-1.png',
      'https://cdn.acme.example.com/location-2.png',
      'https://cdn.acme.example.com/location-3.png'
    ],
    subAccountPreviewVideoUrl: 'https://youtu.be/lmnopqrstuv',
    supportConfig: {
      supportEmail: 'support@acme.example.com',
      supportPhone: '',
      websiteUrl: 'https://acme.example.com/support',
      documentationUrl: 'https://docs.acme.example.com',
      termsAndConditionsUrl: 'https://acme.example.com/terms',
      privacyPolicyUrl: 'https://acme.example.com/privacy',
      supportedServices: []
    },
    allowedScopes: ['contacts.readonly'],
    redirectUris: ['https://acme.example.com/oauth/callback'],
    defaults: { clientKey: 'client-1', redirectUrl: 'https://acme.example.com/oauth/callback' },
    clientKeys: [{ id: 'client-1', name: 'Production', isDefault: true }],
    webhookUrl: 'https://api.acme.example.com/webhooks',
    subscribedEvents: [
      { name: 'ContactCreate' },
      { name: 'ContactUpdate', url: 'https://api.acme.example.com/contact-update' }
    ],
    billingType: 'free',
    isPaidApp: false,
    isFreemium: false,
    externalBilling: false,
    externalBillingUrl: '',
    hasFreeTrial: false,
    additionalDetails: '',
    endToEndDemoUrl: 'https://youtu.be/12345678901',
    scopesDemoUrl: 'https://youtu.be/10987654321',
    privateReason: '',
    ...overrides
  }
}

export function completeAppFiles(overrides: Partial<AppVersion> = {}): AppFiles {
  return buildAppFiles(completeAppVersion(overrides))
}

export function cloneAppFiles(files: AppFiles): AppFiles {
  return structuredClone(files)
}
