import { BUSINESS_NICHE_VALUES, SUBCATEGORY_VALUES } from '../categories.js'
import { APP_NAME_MAX_LENGTH } from '../create.js'
import { MAX_SCREENSHOTS_PER_PROFILE } from '../media.js'
import { DESCRIPTION_MAX_LENGTH, DESCRIPTION_MIN_LENGTH, SUPPORTED_SERVICES } from '../profile-sections.js'
import {
  MAX_URL_LENGTH,
  OAUTH_SCOPE_PATTERN,
  RESOURCE_IDENTIFIER_PATTERN,
  arrayOf,
  booleanValue,
  nonBlankString,
  object,
  optionalHttpsUrl,
  requiredHttpUrl,
  requiredHttpsUrl,
  rootSchema,
  stringArray,
  stringValue,
  type JsonSchema
} from './builders.js'

const TAGLINE_MIN_LENGTH = 20
const TAGLINE_MAX_LENGTH = 170
const COMPANY_NAME_MAX_LENGTH = 50
const SEARCH_KEYWORDS_MAX_LENGTH = 200
const REVIEW_TEXT_MAX_LENGTH = 500
const SECURITY_TEXT_MAX_LENGTH = 10_000
const OPTIONAL_NORMALIZED_HTTPS_PATTERN = '^(?:$|https://.*|(?!(?:[A-Za-z][A-Za-z0-9+.-]*):\\/\\/).+)$'

const imageUrl = (description: string): JsonSchema =>
  stringValue({
    maxLength: MAX_URL_LENGTH,
    pattern: '^(?:$|https://.*\\.(?:[pP][nN][gG]|[jJ][pP](?:[eE])?[gG]|[sS][vV][gG]|[gG][iI][fF])(?:[?#].*)?$)',
    description
  })

const youtubeUrl = (description: string): JsonSchema =>
  stringValue({
    maxLength: MAX_URL_LENGTH,
    pattern:
      '^(?:$|https://(?:www\\.)?youtube\\.com/(?:watch\\?.*v=|embed/)[A-Za-z0-9_-]{11}(?:[&#?].*)?$|https://youtu\\.be/[A-Za-z0-9_-]{11}(?:[?#].*)?$)',
    description
  })

const optionalEmail = (description: string): JsonSchema =>
  stringValue({
    maxLength: 254,
    pattern: "^(?:$|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[^\\s@]+\\.[A-Za-z]{2,63}|\\[(?:\\d{1,3}\\.){3}\\d{1,3}\\]))$",
    description
  })

const supportUrl = (description: string): JsonSchema =>
  stringValue({ maxLength: MAX_URL_LENGTH, pattern: OPTIONAL_NORMALIZED_HTTPS_PATTERN, description })

const profileDescription = (description: string): JsonSchema =>
  stringValue({
    maxLength: SECURITY_TEXT_MAX_LENGTH,
    description: `${description} Must contain ${DESCRIPTION_MIN_LENGTH.toLocaleString('en-US')}–${DESCRIPTION_MAX_LENGTH.toLocaleString('en-US')} plain-text characters; HTML tags do not count.`
  })

const basicInfoSchema = object(
  {
    name: stringValue({
      maxLength: APP_NAME_MAX_LENGTH,
      description: `App name. Standard apps require 1–${APP_NAME_MAX_LENGTH} characters and at least one visible character.`
    }),
    tagline: stringValue({
      maxLength: TAGLINE_MAX_LENGTH,
      description: `Marketplace tagline. Standard apps require ${TAGLINE_MIN_LENGTH}–${TAGLINE_MAX_LENGTH} characters after trimming.`
    }),
    companyName: nonBlankString({
      maxLength: COMPANY_NAME_MAX_LENGTH,
      description: `Publisher company name; 1–${COMPANY_NAME_MAX_LENGTH} characters.`
    }),
    contact: object(
      {
        name: stringValue({ description: 'Read-only publisher contact name from the last pull.' }),
        email: stringValue({ description: 'Read-only publisher contact email from the last pull.' })
      },
      ['name', 'email']
    ),
    website: optionalHttpsUrl('Optional publisher website; must be a valid HTTPS URL.'),
    category: stringValue({ description: 'Read-only legacy category returned by the marketplace.' }),
    subcategory: stringArray(
      {
        maxItems: 3,
        uniqueItems: true,
        description: 'Select between one and three marketplace subcategories.'
      },
      { enum: [...SUBCATEGORY_VALUES] }
    ),
    businessNiche: stringArray(
      {
        maxItems: 3,
        uniqueItems: true,
        description: 'Select up to three marketplace business niches.'
      },
      { enum: [...BUSINESS_NICHE_VALUES] }
    ),
    logoUrl: imageUrl('Optional logo URL; must use HTTPS and end in .png, .jpg, .jpeg, .svg, or .gif.')
  },
  ['name', 'tagline', 'companyName', 'contact', 'website', 'category', 'subcategory', 'businessNiche', 'logoUrl']
)

const listingSchema: JsonSchema = {
  ...object(
    {
      private: booleanValue({ description: 'Whether the app listing is private.' }),
      userTypes: arrayOf(
        { enum: ['Company', 'Location'] },
        {
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          description: 'Install targets: Company for agencies and Location for sub-accounts.'
        }
      ),
      isWhiteLabelFriendly: booleanValue({ description: 'Whether marketplace branding must be white-label safe.' }),
      isAgencyBulkInstallEnabled: booleanValue({
        description: 'Must be enabled when both Company and Location are selected, and disabled for Company-only apps.'
      }),
      searchKeywords: stringArray(
        {
          uniqueItems: true,
          description: `Unique, non-blank search keywords with at most ${SEARCH_KEYWORDS_MAX_LENGTH} characters in total. The CLI enforces the total.`
        },
        nonBlankString({ maxLength: SEARCH_KEYWORDS_MAX_LENGTH })
      )
    },
    ['private', 'userTypes', 'isWhiteLabelFriendly', 'isAgencyBulkInstallEnabled', 'searchKeywords']
  ),
  allOf: [
    {
      if: { properties: { userTypes: { const: ['Company'] } }, required: ['userTypes'] },
      then: { properties: { isAgencyBulkInstallEnabled: { const: false } } }
    },
    {
      if: {
        properties: {
          userTypes: {
            allOf: [{ contains: { const: 'Company' } }, { contains: { const: 'Location' } }]
          }
        },
        required: ['userTypes']
      },
      then: { properties: { isAgencyBulkInstallEnabled: { const: true } } }
    }
  ]
}

const subAccountProfileSchema: JsonSchema = {
  ...object(
    {
      enabled: booleanValue({ description: 'Whether a separate sub-account marketplace profile is enabled.' }),
      description: profileDescription('Sub-account marketplace description.'),
      previewImageUrls: stringArray(
        {
          maxItems: MAX_SCREENSHOTS_PER_PROFILE,
          description: `Sub-account screenshots; an enabled profile requires 3–${MAX_SCREENSHOTS_PER_PROFILE}.`
        },
        imageUrl('Sub-account screenshot URL; must use HTTPS and a supported image extension.')
      ),
      previewVideoUrl: youtubeUrl('Optional sub-account preview video; must be a supported HTTPS YouTube URL.')
    },
    ['enabled', 'description', 'previewImageUrls', 'previewVideoUrl']
  ),
  allOf: [
    {
      if: { properties: { enabled: { const: true } }, required: ['enabled'] },
      then: {
        properties: {
          description: nonBlankString({ minLength: DESCRIPTION_MIN_LENGTH, maxLength: SECURITY_TEXT_MAX_LENGTH }),
          previewImageUrls: { minItems: 3 }
        }
      },
      else: {
        properties: {
          description: { const: '' },
          previewImageUrls: { maxItems: 0 },
          previewVideoUrl: { const: '' }
        }
      }
    }
  ]
}

const profilesSchema = object(
  {
    agency: object(
      {
        description: profileDescription('Agency marketplace description.'),
        previewImageUrls: stringArray(
          {
            maxItems: MAX_SCREENSHOTS_PER_PROFILE,
            description: `Up to ${MAX_SCREENSHOTS_PER_PROFILE} agency profile screenshots.`
          },
          imageUrl('Agency screenshot URL; must use HTTPS and a supported image extension.')
        ),
        previewVideoUrl: youtubeUrl('Optional agency preview video; must be a supported HTTPS YouTube URL.')
      },
      ['description', 'previewImageUrls', 'previewVideoUrl']
    ),
    subAccount: subAccountProfileSchema
  },
  ['agency', 'subAccount']
)

const oauthSchema = object(
  {
    allowedScopes: stringArray(
      {
        uniqueItems: true,
        description: 'Unique OAuth scopes. The CLI validates them against the live scope catalog before push.'
      },
      stringValue({ minLength: 1, maxLength: 200, pattern: OAUTH_SCOPE_PATTERN })
    ),
    redirectUris: stringArray(
      { uniqueItems: true, description: 'Unique OAuth redirect URLs using HTTP or HTTPS.' },
      requiredHttpUrl('OAuth redirect URL; must use HTTP or HTTPS.')
    ),
    defaults: object(
      {
        clientKey: {
          type: ['string', 'null'],
          description: 'Read-only default OAuth client key id; use `ghl app keys` to change it.'
        },
        redirectUrl: {
          type: ['string', 'null'],
          description: 'Default redirect URL; it must also appear in redirectUris.'
        }
      },
      ['clientKey', 'redirectUrl']
    ),
    clientKeys: arrayOf(
      object(
        {
          id: nonBlankString({ description: 'Read-only OAuth client key id.' }),
          name: stringValue({ description: 'Read-only OAuth client key name.' }),
          isDefault: booleanValue({ description: 'Whether this is the default OAuth client key.' })
        },
        ['id', 'name', 'isDefault']
      ),
      { description: 'Read-only OAuth client keys; manage them with `ghl app keys`.' }
    )
  },
  ['allowedScopes', 'redirectUris', 'defaults', 'clientKeys']
)

const supportSchema: JsonSchema = {
  ...object(
    {
      supportEmail: optionalEmail('Support email. Either supportEmail or supportPhone must be provided.'),
      supportPhone: stringValue({
        pattern: '^(?:$|(?=(?:\\D*\\d){7,15}\\D*$)\\+?[\\d()\\s.-]+)$',
        description:
          'Support phone. Either supportEmail or supportPhone must be provided; phone numbers need 7–15 digits.'
      }),
      websiteUrl: supportUrl('Optional support website; a missing scheme is treated as HTTPS.'),
      documentationUrl: supportUrl('Optional documentation page; a missing scheme is treated as HTTPS.'),
      termsAndConditionsUrl: supportUrl('Optional terms and conditions page; a missing scheme is treated as HTTPS.'),
      privacyPolicyUrl: supportUrl('Optional privacy policy page; a missing scheme is treated as HTTPS.'),
      supportedServices: arrayOf(
        { enum: [...SUPPORTED_SERVICES] },
        { uniqueItems: true, description: 'Supported service categories. Template apps require at least one.' }
      )
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
  anyOf: [
    { properties: { supportEmail: nonBlankString() }, required: ['supportEmail'] },
    { properties: { supportPhone: nonBlankString() }, required: ['supportPhone'] }
  ]
}

const billingSchema: JsonSchema = {
  ...object(
    {
      billingType: { enum: ['free', 'freemium', 'paid'], description: 'Marketplace billing model.' },
      isPaidApp: booleanValue({ description: 'Read-only value derived from billingType.' }),
      isFreemium: booleanValue({ description: 'Read-only value derived from billingType.' }),
      externalBilling: booleanValue({ description: 'Whether paid billing is handled by an external provider.' }),
      externalBillingUrl: stringValue({
        maxLength: MAX_URL_LENGTH,
        pattern: OPTIONAL_NORMALIZED_HTTPS_PATTERN,
        description: 'External billing host or HTTPS URL. Required only when externalBilling is enabled.'
      }),
      hasFreeTrial: booleanValue({ description: 'Whether this paid or freemium app offers a free trial.' }),
      freeTrialDuration: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 90,
        description: 'Trial duration in days (1–90), or null when free trials are disabled.'
      },
      hasUsageBasedPrice: booleanValue({ description: 'Read-only usage-based billing state.' }),
      paymentType: stringValue({ description: 'Read-only payment type derived from subscription plans.' }),
      oneTimePrice: { type: ['number', 'null'], minimum: 0, description: 'Read-only one-time price.' },
      additionalInfoForBilling: stringValue({
        description: 'Read-only billing information returned by the marketplace.'
      })
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
  allOf: [
    {
      if: { properties: { billingType: { const: 'free' } }, required: ['billingType'] },
      then: { properties: { isPaidApp: { const: false }, isFreemium: { const: false } } }
    },
    {
      if: { properties: { billingType: { const: 'paid' } }, required: ['billingType'] },
      then: { properties: { isPaidApp: { const: true }, isFreemium: { const: false } } }
    },
    {
      if: { properties: { billingType: { const: 'freemium' } }, required: ['billingType'] },
      then: { properties: { isPaidApp: { const: true }, isFreemium: { const: true } } }
    },
    {
      if: { properties: { externalBilling: { const: true } }, required: ['externalBilling'] },
      then: {
        properties: {
          billingType: { const: 'paid' },
          externalBillingUrl: nonBlankString({ maxLength: MAX_URL_LENGTH }),
          hasFreeTrial: { const: false }
        }
      },
      else: { properties: { externalBillingUrl: { const: '' } } }
    },
    {
      if: { properties: { hasFreeTrial: { const: true } }, required: ['hasFreeTrial'] },
      then: {
        properties: {
          billingType: { enum: ['freemium', 'paid'] },
          externalBilling: { const: false },
          freeTrialDuration: { type: 'integer', minimum: 1, maximum: 90 }
        }
      },
      else: { properties: { freeTrialDuration: { const: null } } }
    }
  ]
}

const reviewSchema = object(
  {
    endToEndDemoUrl: optionalHttpsUrl('End-to-end demo URL; required for standard app review and must use HTTPS.'),
    scopesDemoUrl: optionalHttpsUrl('OAuth scopes demo URL; required for standard app review and must use HTTPS.'),
    additionalDetails: stringValue({
      maxLength: REVIEW_TEXT_MAX_LENGTH,
      description: `Optional app review notes; at most ${REVIEW_TEXT_MAX_LENGTH} characters.`
    }),
    privateReason: stringValue({
      maxLength: REVIEW_TEXT_MAX_LENGTH,
      description: `Reason for a private listing; required for private apps and limited to ${REVIEW_TEXT_MAX_LENGTH} characters.`
    })
  },
  ['endToEndDemoUrl', 'scopesDemoUrl', 'additionalDetails', 'privateReason']
)

const appBaseSchema = rootSchema(
  'app',
  'HighLevel App Manifest',
  {
    schemaVersion: { const: 1, description: 'Generated manifest schema version.' },
    appId: {
      type: 'string',
      pattern: RESOURCE_IDENTIFIER_PATTERN,
      description: 'Read-only HighLevel app identifier from the last pull.'
    },
    versionId: {
      type: 'string',
      pattern: RESOURCE_IDENTIFIER_PATTERN,
      description: 'Read-only HighLevel app version identifier from the last pull.'
    },
    createdAt: stringValue({ description: 'Read-only app creation timestamp used by billing eligibility checks.' }),
    version: stringValue({ description: 'Read-only marketplace version from the last pull.' }),
    status: stringValue({ description: 'Read-only marketplace version status from the last pull.' }),
    appType: stringValue({ description: 'Read-only app type, normally standard or template.' }),
    basicInfo: basicInfoSchema,
    listing: listingSchema,
    profiles: profilesSchema,
    oauth: oauthSchema,
    supportConfig: supportSchema,
    billing: billingSchema,
    review: reviewSchema
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
  description: 'Editable local app manifest. The CLI also performs contextual, remote-catalog, and security checks.',
  allOf: [
    {
      if: {
        properties: { appType: { not: { const: 'template' } } },
        required: ['appType']
      },
      then: {
        properties: {
          basicInfo: {
            properties: {
              name: nonBlankString({ maxLength: APP_NAME_MAX_LENGTH }),
              tagline: nonBlankString({ minLength: TAGLINE_MIN_LENGTH, maxLength: TAGLINE_MAX_LENGTH }),
              subcategory: { minItems: 1 }
            }
          },
          profiles: {
            properties: {
              agency: {
                properties: {
                  description: nonBlankString({
                    minLength: DESCRIPTION_MIN_LENGTH,
                    maxLength: SECURITY_TEXT_MAX_LENGTH
                  })
                }
              }
            }
          },
          review: {
            properties: {
              endToEndDemoUrl: requiredHttpsUrl('Required end-to-end demo URL.'),
              scopesDemoUrl: requiredHttpsUrl('Required OAuth scopes demo URL.')
            }
          }
        }
      }
    },
    {
      if: { properties: { appType: { const: 'template' } }, required: ['appType'] },
      then: {
        properties: {
          supportConfig: { properties: { supportedServices: { minItems: 1 } } },
          billing: {
            properties: {
              billingType: { enum: ['free', 'paid'] },
              isFreemium: { const: false },
              externalBilling: { const: false },
              hasFreeTrial: { const: false }
            }
          }
        }
      }
    },
    {
      if: {
        properties: { listing: { properties: { private: { const: true } }, required: ['private'] } },
        required: ['listing']
      },
      then: { properties: { review: { properties: { privateReason: nonBlankString({ maxLength: 500 }) } } } }
    }
  ]
}
