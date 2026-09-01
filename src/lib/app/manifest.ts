import { AppVersion } from '../api/client.js'

export interface AppManifest {
  schemaVersion: 1
  appId: string
  versionId: string
  createdAt?: string
  version: string
  status: string
  appType: string
  basicInfo: {
    name: string
    tagline: string
    companyName: string
    contact: { email: string; name: string }
    website: string
    category: string
    subcategory: string[]
    businessNiche: string[]
    logoUrl: string
  }
  listing: {
    private: boolean
    userTypes: string[]
    isWhiteLabelFriendly: boolean
    isAgencyBulkInstallEnabled: boolean
    searchKeywords: string[]
  }
  profiles: {
    agency: { description: string; previewImageUrls: string[]; previewVideoUrl: string }
    subAccount: {
      enabled: boolean
      description: string
      previewImageUrls: string[]
      previewVideoUrl: string
    }
  }
  oauth: {
    allowedScopes: string[]
    redirectUris: string[]
    defaults: { clientKey: null | string; redirectUrl: null | string }
    clientKeys: Array<{ id: string; name: string; isDefault: boolean }>
  }
  supportConfig: {
    supportEmail: string
    supportPhone: string
    websiteUrl: string
    documentationUrl: string
    termsAndConditionsUrl: string
    privacyPolicyUrl: string
    supportedServices: string[]
  }
  billing: {
    billingType: 'free' | 'freemium' | 'paid'
    isPaidApp: boolean
    isFreemium: boolean
    externalBilling: boolean
    externalBillingUrl: string
    hasFreeTrial: boolean
    freeTrialDuration: number | null
    hasUsageBasedPrice: boolean
    paymentType: string
    oneTimePrice: number | null
    additionalInfoForBilling: string
  }
  review: {
    endToEndDemoUrl: string
    scopesDemoUrl: string
    additionalDetails: string
    privateReason: string
  }
}

export interface WebhookManifest {
  schemaVersion: 1
  appId: string
  versionId: string
  webhookUrl: string
  subscribedEvents: Array<{ name: string; url?: string }>
}

export interface AppFiles {
  app: AppManifest
  webhooks: WebhookManifest
}

function billingType(version: AppVersion): 'free' | 'freemium' | 'paid' {
  if (version.billingType) return version.billingType
  if (version.isFreemium) return 'freemium'
  return version.isPaidApp ? 'paid' : 'free'
}

export function buildAppFiles(version: AppVersion): AppFiles {
  const appId = String(version.appId ?? version._id)
  const model = billingType(version)
  const clientKeys = (version.clientKeys ?? []).flatMap(key => {
    if (key.deleted || typeof key.id !== 'string' || key.id.length === 0) return []
    return [
      {
        id: key.id,
        name: key.name ?? '',
        isDefault: key.isDefault ?? key.default ?? version.defaults?.clientKey === key.id
      }
    ]
  })

  return {
    app: {
      schemaVersion: 1,
      appId,
      versionId: version._id,
      ...(version.createdAt ? { createdAt: version.createdAt } : {}),
      version: version.version ?? '1.0.0',
      status: version.status ?? 'draft',
      appType: version.appType ?? 'standard',
      basicInfo: {
        name: version.name ?? '',
        tagline: version.tagline ?? '',
        companyName: version.companyName ?? '',
        contact: {
          name: version.contact?.name ?? '',
          email: version.contact?.email ?? ''
        },
        website: version.website ?? '',
        category: version.category ?? '',
        subcategory: version.subcategory ?? [],
        businessNiche: version.businessNiche ?? [],
        logoUrl: version.logoUrl ?? ''
      },
      listing: {
        private: version.private ?? false,
        userTypes: version.userTypes ?? [],
        isWhiteLabelFriendly: version.isWhiteLabelFriendly ?? true,
        isAgencyBulkInstallEnabled: version.isAgencyBulkInstallEnabled ?? false,
        searchKeywords: version.searchKeywords ?? []
      },
      profiles: {
        agency: {
          description: version.description ?? '',
          previewImageUrls: version.previewImageUrls ?? [],
          previewVideoUrl: version.previewVideoUrl ?? ''
        },
        subAccount: {
          enabled: version.hasSubAccountProfile ?? false,
          description: version.subAccountDescription ?? '',
          previewImageUrls: version.subAccountPreviewImageUrls ?? [],
          previewVideoUrl: version.subAccountPreviewVideoUrl ?? ''
        }
      },
      oauth: {
        allowedScopes: version.allowedScopes ?? [],
        redirectUris: version.redirectUris ?? [],
        defaults: {
          clientKey: version.defaults?.clientKey ?? null,
          redirectUrl: version.defaults?.redirectUrl ?? null
        },
        clientKeys
      },
      supportConfig: {
        supportEmail: version.supportConfig?.supportEmail ?? '',
        supportPhone: version.supportConfig?.supportPhone ?? '',
        websiteUrl: version.supportConfig?.websiteUrl ?? '',
        documentationUrl: version.supportConfig?.documentationUrl ?? '',
        termsAndConditionsUrl: version.supportConfig?.termsAndConditionsUrl ?? '',
        privacyPolicyUrl: version.supportConfig?.privacyPolicyUrl ?? '',
        supportedServices: version.supportConfig?.supportedServices ?? []
      },
      billing: {
        billingType: model,
        isPaidApp: version.isPaidApp ?? model !== 'free',
        isFreemium: version.isFreemium ?? model === 'freemium',
        externalBilling: version.externalBilling ?? false,
        externalBillingUrl: version.externalBillingUrl ?? '',
        hasFreeTrial: version.hasFreeTrial ?? false,
        freeTrialDuration: version.freeTrialDuration ?? null,
        hasUsageBasedPrice: version.hasUsageBasedPrice ?? false,
        paymentType: version.paymentType ?? '',
        oneTimePrice: version.oneTimePrice ?? null,
        additionalInfoForBilling: version.additionalInfoForBilling ?? ''
      },
      review: {
        endToEndDemoUrl: version.endToEndDemoUrl ?? '',
        scopesDemoUrl: version.scopesDemoUrl ?? '',
        additionalDetails: version.additionalDetails ?? '',
        privateReason: version.privateReason ?? ''
      }
    },
    webhooks: {
      schemaVersion: 1,
      appId,
      versionId: version._id,
      webhookUrl: version.webhookUrl ?? '',
      subscribedEvents: (version.subscribedEvents ?? []).map(event => ({
        name: event.name,
        ...(event.url ? { url: event.url } : {})
      }))
    }
  }
}
