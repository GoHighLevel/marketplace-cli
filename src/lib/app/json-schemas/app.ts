import {
  RESOURCE_IDENTIFIER_PATTERN,
  arrayOf,
  booleanValue,
  nonBlankString,
  nullableNumber,
  object,
  rootSchema,
  stringArray,
  stringValue,
  type JsonSchema
} from './builders.js'
import { SUPPORTED_SERVICES } from '../profile-sections.js'

const appBaseSchema = rootSchema(
  'app',
  'HighLevel App Manifest',
  {
    schemaVersion: { const: 1 },
    appId: { type: 'string', pattern: RESOURCE_IDENTIFIER_PATTERN },
    versionId: { type: 'string', pattern: RESOURCE_IDENTIFIER_PATTERN },
    createdAt: stringValue(),
    version: stringValue(),
    status: stringValue(),
    appType: stringValue(),
    basicInfo: object(
      {
        name: stringValue(),
        tagline: stringValue(),
        companyName: stringValue(),
        contact: object({ name: stringValue(), email: stringValue() }, ['name', 'email']),
        website: stringValue(),
        category: stringValue(),
        subcategory: stringArray({ maxItems: 3, uniqueItems: true }),
        businessNiche: stringArray({ maxItems: 3, uniqueItems: true }),
        logoUrl: stringValue()
      },
      ['name', 'tagline', 'companyName', 'contact', 'website', 'category', 'subcategory', 'businessNiche', 'logoUrl']
    ),
    listing: object(
      {
        private: booleanValue(),
        userTypes: arrayOf({ enum: ['Company', 'Location'] }, { minItems: 1, maxItems: 2, uniqueItems: true }),
        isWhiteLabelFriendly: booleanValue(),
        isAgencyBulkInstallEnabled: booleanValue(),
        searchKeywords: stringArray({ uniqueItems: true })
      },
      ['private', 'userTypes', 'isWhiteLabelFriendly', 'isAgencyBulkInstallEnabled', 'searchKeywords']
    ),
    profiles: object(
      {
        agency: object(
          {
            description: stringValue(),
            previewImageUrls: stringArray({ maxItems: 9 }),
            previewVideoUrl: stringValue()
          },
          ['description', 'previewImageUrls', 'previewVideoUrl']
        ),
        subAccount: object(
          {
            enabled: booleanValue(),
            description: stringValue(),
            previewImageUrls: stringArray({ maxItems: 9 }),
            previewVideoUrl: stringValue()
          },
          ['enabled', 'description', 'previewImageUrls', 'previewVideoUrl']
        )
      },
      ['agency', 'subAccount']
    ),
    oauth: object(
      {
        allowedScopes: stringArray({ uniqueItems: true }),
        redirectUris: stringArray({ uniqueItems: true }),
        defaults: object(
          {
            clientKey: { type: ['string', 'null'] },
            redirectUrl: { type: ['string', 'null'] }
          },
          ['clientKey', 'redirectUrl']
        ),
        clientKeys: arrayOf(
          object({ id: stringValue(), name: stringValue(), isDefault: booleanValue() }, ['id', 'name', 'isDefault'])
        )
      },
      ['allowedScopes', 'redirectUris', 'defaults', 'clientKeys']
    ),
    supportConfig: object(
      {
        supportEmail: stringValue(),
        supportPhone: stringValue(),
        websiteUrl: stringValue(),
        documentationUrl: stringValue(),
        termsAndConditionsUrl: stringValue(),
        privacyPolicyUrl: stringValue(),
        supportedServices: arrayOf({ enum: [...SUPPORTED_SERVICES] }, { uniqueItems: true })
      },
      [
        'supportEmail',
        'supportPhone',
        'websiteUrl',
        'documentationUrl',
        'termsAndConditionsUrl',
        'privacyPolicyUrl',
        'supportedServices'
      ]
    ),
    billing: object(
      {
        billingType: { enum: ['free', 'freemium', 'paid'] },
        isPaidApp: booleanValue(),
        isFreemium: booleanValue(),
        externalBilling: booleanValue(),
        externalBillingUrl: stringValue(),
        hasFreeTrial: booleanValue(),
        freeTrialDuration: nullableNumber(),
        hasUsageBasedPrice: booleanValue(),
        paymentType: stringValue(),
        oneTimePrice: nullableNumber(),
        additionalInfoForBilling: stringValue()
      },
      [
        'billingType',
        'isPaidApp',
        'isFreemium',
        'externalBilling',
        'externalBillingUrl',
        'hasFreeTrial',
        'freeTrialDuration',
        'hasUsageBasedPrice',
        'paymentType',
        'oneTimePrice',
        'additionalInfoForBilling'
      ]
    ),
    review: object(
      {
        endToEndDemoUrl: stringValue(),
        scopesDemoUrl: stringValue(),
        additionalDetails: stringValue(),
        privateReason: stringValue()
      },
      ['endToEndDemoUrl', 'scopesDemoUrl', 'additionalDetails', 'privateReason']
    )
  },
  [
    'schemaVersion',
    'appId',
    'versionId',
    'version',
    'status',
    'appType',
    'basicInfo',
    'listing',
    'profiles',
    'oauth',
    'supportConfig',
    'billing',
    'review'
  ]
)

export const appSchema: JsonSchema = {
  ...appBaseSchema,
  allOf: [
    {
      if: {
        properties: { appType: { not: { const: 'template' } } },
        required: ['appType']
      },
      then: {
        properties: {
          basicInfo: {
            properties: { name: nonBlankString() }
          }
        }
      }
    }
  ]
}
