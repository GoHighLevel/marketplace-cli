import { isRecord } from '../api/response.js'
import { AppFiles } from './manifest.js'
import { WorkspaceState } from './workspace.js'

type Check = (value: unknown, path: string, errors: string[]) => void
type FieldRule = { check: Check; optional?: boolean }

const stringValue: Check = (value, path, errors) => {
  if (typeof value !== 'string') errors.push(`${path} must be a string.`)
}
const booleanValue: Check = (value, path, errors) => {
  if (typeof value !== 'boolean') errors.push(`${path} must be a boolean.`)
}
const finiteNumber: Check = (value, path, errors) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path} must be a finite number.`)
}

function literalValue(...allowed: Array<boolean | number | string>): Check {
  return (value, path, errors) => {
    if (!allowed.includes(value as boolean | number | string)) {
      errors.push(`${path} must be one of: ${allowed.map(item => JSON.stringify(item)).join(', ')}.`)
    }
  }
}

function nullable(check: Check): Check {
  return (value, path, errors) => {
    if (value !== null) check(value, path, errors)
  }
}

function arrayOf(check: Check): Check {
  return (value, path, errors) => {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array.`)
      return
    }
    value.forEach((item, index) => check(item, `${path}[${index}]`, errors))
  }
}

function exactObject(fields: Record<string, FieldRule>): Check {
  return (value, path, errors) => {
    if (!isRecord(value)) {
      errors.push(`${path} must be an object.`)
      return
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(fields, key)) errors.push(`${path}.${key} is not a supported property.`)
    }
    for (const [key, rule] of Object.entries(fields)) {
      if (!Object.hasOwn(value, key)) {
        if (!rule.optional) errors.push(`${path}.${key} is required.`)
        continue
      }
      rule.check(value[key], `${path}.${key}`, errors)
    }
  }
}

const appManifestShape = exactObject({
  schemaVersion: { check: literalValue(1) },
  appId: { check: stringValue },
  versionId: { check: stringValue },
  createdAt: { check: stringValue, optional: true },
  version: { check: stringValue },
  status: { check: stringValue },
  appType: { check: stringValue },
  basicInfo: {
    check: exactObject({
      name: { check: stringValue },
      tagline: { check: stringValue },
      companyName: { check: stringValue },
      contact: { check: exactObject({ name: { check: stringValue }, email: { check: stringValue } }) },
      website: { check: stringValue },
      category: { check: stringValue },
      subcategory: { check: arrayOf(stringValue) },
      businessNiche: { check: arrayOf(stringValue) },
      logoUrl: { check: stringValue }
    })
  },
  listing: {
    check: exactObject({
      private: { check: booleanValue },
      userTypes: { check: arrayOf(stringValue) },
      isWhiteLabelFriendly: { check: booleanValue },
      isAgencyBulkInstallEnabled: { check: booleanValue },
      searchKeywords: { check: arrayOf(stringValue) }
    })
  },
  profiles: {
    check: exactObject({
      agency: {
        check: exactObject({
          description: { check: stringValue },
          previewImageUrls: { check: arrayOf(stringValue) },
          previewVideoUrl: { check: stringValue }
        })
      },
      subAccount: {
        check: exactObject({
          enabled: { check: booleanValue },
          description: { check: stringValue },
          previewImageUrls: { check: arrayOf(stringValue) },
          previewVideoUrl: { check: stringValue }
        })
      }
    })
  },
  oauth: {
    check: exactObject({
      allowedScopes: { check: arrayOf(stringValue) },
      redirectUris: { check: arrayOf(stringValue) },
      defaults: {
        check: exactObject({ clientKey: { check: nullable(stringValue) }, redirectUrl: { check: nullable(stringValue) } })
      },
      clientKeys: {
        check: arrayOf(
          exactObject({ id: { check: stringValue }, name: { check: stringValue }, isDefault: { check: booleanValue } })
        )
      }
    })
  },
  supportConfig: {
    check: exactObject({
      supportEmail: { check: stringValue },
      supportPhone: { check: stringValue },
      websiteUrl: { check: stringValue },
      documentationUrl: { check: stringValue },
      termsAndConditionsUrl: { check: stringValue },
      privacyPolicyUrl: { check: stringValue },
      supportedServices: { check: arrayOf(stringValue) }
    })
  },
  billing: {
    check: exactObject({
      billingType: { check: literalValue('free', 'freemium', 'paid') },
      isPaidApp: { check: booleanValue },
      isFreemium: { check: booleanValue },
      externalBilling: { check: booleanValue },
      externalBillingUrl: { check: stringValue },
      hasFreeTrial: { check: booleanValue },
      freeTrialDuration: { check: nullable(finiteNumber) },
      hasUsageBasedPrice: { check: booleanValue },
      paymentType: { check: stringValue },
      oneTimePrice: { check: nullable(finiteNumber) },
      additionalInfoForBilling: { check: stringValue }
    })
  },
  review: {
    check: exactObject({
      endToEndDemoUrl: { check: stringValue },
      scopesDemoUrl: { check: stringValue },
      additionalDetails: { check: stringValue },
      privateReason: { check: stringValue }
    })
  }
})

const webhookManifestShape = exactObject({
  schemaVersion: { check: literalValue(1) },
  appId: { check: stringValue },
  versionId: { check: stringValue },
  webhookUrl: { check: stringValue },
  subscribedEvents: {
    check: arrayOf(exactObject({ name: { check: stringValue }, url: { check: stringValue, optional: true } }))
  }
})

const appFilesShape = exactObject({
  app: { check: appManifestShape },
  webhooks: { check: webhookManifestShape }
})

const workspaceStateShape = exactObject({
  schemaVersion: { check: literalValue(1) },
  appId: { check: stringValue },
  versionId: { check: stringValue },
  baseline: { check: appFilesShape }
})

export function validateAppWorkspaceSchema(files: AppFiles, state: WorkspaceState): string[] {
  const errors: string[] = []
  appFilesShape(files, 'workspace', errors)
  workspaceStateShape(state, '.ghl/state.json', errors)
  return errors
}
