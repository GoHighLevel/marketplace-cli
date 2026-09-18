import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Ajv from 'ajv'
import { afterEach, describe, expect, it } from 'vitest'

import {
  JSON_SCHEMA_NAMES,
  JSON_SCHEMA_REFERENCES,
  JSON_SCHEMA_RELATIVE_PATHS,
  getJsonSchema,
  validateJsonSchema,
  validateJsonSchemaStructure,
  writeJsonSchemaWorkspace
} from '../../../src/lib/app/json-schema.js'

const directories: string[] = []

type SchemaObject = Record<string, unknown>

function schemaObject(value: unknown): SchemaObject {
  expect(value).toBeTypeOf('object')
  expect(value).not.toBeNull()
  expect(Array.isArray(value)).toBe(false)
  return value as SchemaObject
}

function schemaProperty(schema: SchemaObject, ...pathSegments: string[]): SchemaObject {
  return pathSegments.reduce((current, segment) => {
    const properties = schemaObject(current.properties)
    return schemaObject(properties[segment])
  }, schema)
}

function schemaAccepts(name: (typeof JSON_SCHEMA_NAMES)[number], value: unknown): boolean {
  const validate = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: false,
    multipleOfPrecision: 8
  }).compile(getJsonSchema(name))
  return validate(value) as boolean
}

function validAppManifest(): SchemaObject {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    versionId: 'version-1',
    version: '1.0.0',
    status: 'draft',
    appType: 'standard',
    basicInfo: {
      name: 'Contact Sync Hub',
      tagline: 'Synchronize contacts safely',
      companyName: 'Contact Sync Labs',
      contact: { name: '', email: '' },
      website: 'https://contact-sync.example.com',
      category: '',
      subcategory: ['crm'],
      businessNiche: ['marketing agency'],
      logoUrl: 'https://contact-sync.example.com/logo.png'
    },
    listing: {
      private: true,
      userTypes: ['Location'],
      isWhiteLabelFriendly: false,
      isAgencyBulkInstallEnabled: false,
      searchKeywords: ['contact sync']
    },
    profiles: {
      agency: {
        description: 'A'.repeat(300),
        previewImageUrls: [],
        previewVideoUrl: ''
      },
      subAccount: {
        enabled: false,
        description: '',
        previewImageUrls: [],
        previewVideoUrl: ''
      }
    },
    oauth: {
      allowedScopes: [],
      redirectUris: [],
      defaults: { clientKey: null, redirectUrl: null },
      clientKeys: []
    },
    supportConfig: {
      supportEmail: 'support@example.com',
      supportPhone: '',
      websiteUrl: 'https://contact-sync.example.com/support',
      documentationUrl: '',
      termsAndConditionsUrl: '',
      privacyPolicyUrl: '',
      supportedServices: []
    },
    billing: {
      billingType: 'free',
      isPaidApp: false,
      isFreemium: false,
      externalBilling: false,
      externalBillingUrl: '',
      hasFreeTrial: false,
      freeTrialDuration: null,
      hasUsageBasedPrice: false,
      paymentType: '',
      oneTimePrice: null,
      additionalInfoForBilling: ''
    },
    review: {
      endToEndDemoUrl: 'https://contact-sync.example.com/demo',
      scopesDemoUrl: 'https://contact-sync.example.com/scopes',
      additionalDetails: '',
      privateReason: 'Internal application'
    }
  }
}

function validWorkflowAction(): SchemaObject {
  return {
    schemaVersion: 1,
    key: 'send_message',
    templateId: 'action-1',
    versions: [
      {
        version: '1.0',
        status: 'published',
        info: { name: 'Send message' },
        inputs: [
          {
            field: 'channel',
            title: 'Channel',
            fieldType: 'select',
            options: [{ label: 'Email', value: 'email' }]
          }
        ],
        executionConfig: { type: 'API', url: 'https://api.example.com/send', method: 'POST' }
      }
    ]
  }
}

function validWebhookManifest(): SchemaObject {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    versionId: 'version-1',
    webhookUrl: 'https://hooks.example.com/default',
    subscribedEvents: [{ name: 'ContactCreate', url: 'https://hooks.example.com/contact' }]
  }
}

function validWorkflowTrigger(): SchemaObject {
  return {
    schemaVersion: 1,
    key: 'contact_created',
    templateId: 'trigger-1',
    versions: [
      {
        version: '1.0',
        status: 'published',
        info: { name: 'Contact created' },
        filters: [
          {
            field: 'country',
            title: 'Country',
            fieldType: 'select',
            options: [{ label: 'India', value: 'IN' }]
          }
        ],
        subscriptionConfig: { url: 'https://api.example.com/subscribe' }
      }
    ]
  }
}

function validSubscription(): SchemaObject {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    plans: [
      {
        name: 'Pro',
        features: ['Automation'],
        paymentTime: 'month',
        paymentType: 'recurring',
        amount: 19.99,
        freePlan: false,
        freeForAgency: false,
        freeForLocation: false
      }
    ]
  }
}

function validUsageMeter(): SchemaObject {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    meters: [
      {
        productType: 'custom',
        productId: 'custom_contact_score',
        productName: 'Contact score',
        customPriceType: 'dynamic',
        usageUnit: 'score',
        pricingPageUrl: 'https://billing.example.com/contact-score',
        tiers: [
          {
            name: 'Scores',
            minVolume: 0,
            maxVolume: null,
            pricePerUnit: 0.02,
            minPricePerUnit: 0.01,
            maxPricePerUnit: 0.05,
            executionLimitPerCycle: 1_000
          }
        ]
      }
    ]
  }
}

function localReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(localReferences)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' && child.startsWith('#/') ? [child] : localReferences(child)
  )
}

function resolveLocalReference(schema: Record<string, unknown>, reference: string): unknown {
  return reference
    .slice(2)
    .split('/')
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>(
      (current, segment) =>
        current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined,
      schema
    )
}

async function workspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-json-schema-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('JSON schema registry', () => {
  it('compiles and validates every emitted contract with the production validator', () => {
    const manifests = {
      app: validAppManifest(),
      webhooks: validWebhookManifest(),
      'workflow-action': validWorkflowAction(),
      'workflow-trigger': validWorkflowTrigger(),
      subscription: validSubscription(),
      'usage-based': validUsageMeter()
    }

    for (const name of JSON_SCHEMA_NAMES) {
      expect(validateJsonSchema(name, manifests[name], name)).toEqual([])
    }
  })

  it('uses the emitted contract for runtime validation without mutating input', () => {
    const invalid = validAppManifest()
    const before = structuredClone(invalid)
    ;(invalid.basicInfo as SchemaObject).name = ''
    invalid.unsupported = true

    expect(validateJsonSchema('app', invalid, 'ghl-app.json')).toEqual(
      expect.arrayContaining([
        'ghl-app.json.unsupported is not a supported property.',
        'ghl-app.json.basicInfo.name must contain at least 1 character.'
      ])
    )
    expect(invalid).toEqual({
      ...before,
      basicInfo: { ...(before.basicInfo as SchemaObject), name: '' },
      unsupported: true
    })
  })

  it('derives compatibility-safe structural validation from the same contract', () => {
    const legacy = validAppManifest()
    ;(legacy.basicInfo as SchemaObject).name = ''
    ;(legacy.profiles as SchemaObject).agency = {
      ...((legacy.profiles as SchemaObject).agency as SchemaObject),
      description: ''
    }

    expect(validateJsonSchemaStructure('app', legacy, 'ghl-app.json')).toEqual([])

    legacy.appId = '../unsafe'
    legacy.unsupported = true
    expect(validateJsonSchemaStructure('app', legacy, 'ghl-app.json')).toEqual(
      expect.arrayContaining([
        'ghl-app.json.appId must contain only letters, numbers, underscores, or hyphens and be 1 to 128 characters.',
        'ghl-app.json.unsupported is not a supported property.'
      ])
    )
  })

  it('covers every user-editable JSON configuration surface with strict draft-07 schemas', () => {
    expect(JSON_SCHEMA_NAMES).toEqual([
      'app',
      'webhooks',
      'workflow-action',
      'workflow-trigger',
      'subscription',
      'usage-based'
    ])

    for (const name of JSON_SCHEMA_NAMES) {
      const schema = getJsonSchema(name)
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#')
      expect(schema.$id).toBe(path.basename(JSON_SCHEMA_RELATIVE_PATHS[name]))
      expect(schema.type).toBe('object')
      expect(schema.additionalProperties).toBe(false)
      expect(schema.properties).toHaveProperty('$schema')
      expect(schema.$comment).toMatch(/generated.*ghl app types.*do not edit/i)
      for (const reference of localReferences(schema)) {
        expect(resolveLocalReference(schema, reference), `${name}: ${reference}`).toBeDefined()
      }
    }

    expect(getJsonSchema('app').properties).toHaveProperty('profiles')
    expect(getJsonSchema('workflow-action').definitions).toHaveProperty('actionInput')
    expect(getJsonSchema('workflow-trigger').definitions).toHaveProperty('triggerFilter')
    expect(getJsonSchema('subscription').definitions).toHaveProperty('subscriptionPlan')
    expect(getJsonSchema('usage-based').definitions).toHaveProperty('usageMeter')
  })

  it('returns independent schema values that callers cannot mutate globally', () => {
    const schema = getJsonSchema('app')
    schema.title = 'Changed by caller'

    expect(getJsonSchema('app').title).toBe('HighLevel App Manifest')
  })

  it('requires standard app names to contain visible characters', () => {
    const schema = getJsonSchema('app')
    expect(schemaObject((schema.allOf as unknown[])[0])).toMatchObject({
      if: {
        properties: { appType: { not: { const: 'template' } } },
        required: ['appType']
      },
      then: {
        properties: {
          basicInfo: {
            properties: {
              name: { type: 'string', minLength: 1, pattern: '\\S' }
            }
          }
        }
      }
    })
  })

  it('describes and constrains app names, taglines, categories, and business niches', () => {
    const schema = getJsonSchema('app')
    const name = schemaProperty(schema, 'basicInfo', 'name')
    const tagline = schemaProperty(schema, 'basicInfo', 'tagline')
    const subcategory = schemaProperty(schema, 'basicInfo', 'subcategory')
    const niche = schemaProperty(schema, 'basicInfo', 'businessNiche')

    expect(name).toMatchObject({ type: 'string', maxLength: 50, description: expect.stringMatching(/1.*50/i) })
    expect(tagline).toMatchObject({
      type: 'string',
      maxLength: 170,
      description: expect.stringMatching(/20.*170/i)
    })
    expect(JSON.stringify(schema.allOf)).toMatch(/tagline.*minLength.*20/)
    expect(subcategory).toMatchObject({
      maxItems: 3,
      uniqueItems: true,
      description: expect.stringMatching(/one.*three/i)
    })
    expect(JSON.stringify(schema.allOf)).toMatch(/subcategory.*minItems.*1/)
    expect(schemaObject(subcategory.items).enum).toContain('crm')
    expect(schemaObject(niche.items).enum).toContain('marketing agency')
  })

  it('rejects app values that violate editor-visible field and cross-field rules', () => {
    const valid = validAppManifest()
    expect(schemaAccepts('app', valid)).toBe(true)

    for (const mutate of [
      (value: SchemaObject) => ((value.basicInfo as SchemaObject).name = ''),
      (value: SchemaObject) => ((value.basicInfo as SchemaObject).tagline = 'Too short'),
      (value: SchemaObject) => ((value.basicInfo as SchemaObject).subcategory = ['not-a-category']),
      (value: SchemaObject) => ((value.basicInfo as SchemaObject).businessNiche = ['not-a-niche']),
      (value: SchemaObject) => {
        const listing = value.listing as SchemaObject
        listing.userTypes = ['Company']
        listing.isAgencyBulkInstallEnabled = true
      },
      (value: SchemaObject) => {
        const billing = value.billing as SchemaObject
        billing.billingType = 'paid'
        billing.isPaidApp = false
      },
      (value: SchemaObject) => {
        const subAccount = (value.profiles as SchemaObject).subAccount as SchemaObject
        subAccount.description = 'Unexpected profile content'
      }
    ]) {
      const invalid = structuredClone(valid)
      mutate(invalid)
      expect(schemaAccepts('app', invalid)).toBe(false)
    }
  })

  it('adds actionable descriptions and local constraints to every configuration schema', () => {
    const webhooks = getJsonSchema('webhooks')
    expect(schemaProperty(webhooks, 'webhookUrl')).toMatchObject({
      description: expect.stringMatching(/https/i)
    })
    expect(schemaProperty(webhooks, 'subscribedEvents')).toMatchObject({
      description: expect.stringMatching(/event/i)
    })

    const action = getJsonSchema('workflow-action')
    expect(schemaProperty(action, 'key')).toMatchObject({ description: expect.stringMatching(/stable/i) })
    expect(schemaObject((action.definitions as SchemaObject).actionInput)).toHaveProperty('allOf')
    expect(schemaObject((action.definitions as SchemaObject).executionConfig)).toHaveProperty('description')

    const trigger = getJsonSchema('workflow-trigger')
    expect(schemaProperty(trigger, 'key')).toMatchObject({ description: expect.stringMatching(/stable/i) })
    expect(schemaObject((trigger.definitions as SchemaObject).triggerFilter)).toHaveProperty('allOf')
    expect(schemaObject((trigger.definitions as SchemaObject).subscriptionConfig)).toHaveProperty('description')

    const subscription = getJsonSchema('subscription')
    expect(schemaProperty(subscription, 'plans')).toMatchObject({ description: expect.stringMatching(/plan/i) })
    expect(schemaObject((subscription.definitions as SchemaObject).subscriptionPlan)).toHaveProperty('allOf')

    const usage = getJsonSchema('usage-based')
    expect(schemaProperty(usage, 'meters')).toMatchObject({ description: expect.stringMatching(/meter/i) })
    expect(schemaObject((usage.definitions as SchemaObject).usageMeter)).toHaveProperty('allOf')
  })

  it('enforces webhook, workflow, and billing relationships without rejecting valid manifests', () => {
    const webhook = validWebhookManifest()
    expect(schemaAccepts('webhooks', webhook)).toBe(true)
    expect(schemaAccepts('webhooks', { ...webhook, webhookUrl: '' })).toBe(false)
    expect(schemaAccepts('webhooks', { ...webhook, subscribedEvents: [{ name: 'not valid', url: '' }] })).toBe(false)

    const action = validWorkflowAction()
    expect(schemaAccepts('workflow-action', action)).toBe(true)
    const typescriptAction = structuredClone(action)
    ;(typescriptAction.versions as SchemaObject[])[0].executionConfig = {
      type: 'CODE',
      codeFile: 'code/send_message.1.0.ts'
    }
    expect(schemaAccepts('workflow-action', typescriptAction)).toBe(true)
    const actionWithTwoSources = structuredClone(action)
    const actionInput = ((actionWithTwoSources.versions as SchemaObject[])[0].inputs as SchemaObject[])[0] ?? {}
    actionInput.fetchOptions = { url: 'https://api.example.com/options' }
    expect(schemaAccepts('workflow-action', actionWithTwoSources)).toBe(false)

    const trigger = validWorkflowTrigger()
    expect(schemaAccepts('workflow-trigger', trigger)).toBe(true)
    const triggerWithoutOptions = structuredClone(trigger)
    delete (((triggerWithoutOptions.versions as SchemaObject[])[0].filters as SchemaObject[])[0] ?? {}).options
    expect(schemaAccepts('workflow-trigger', triggerWithoutOptions)).toBe(false)

    const subscription = validSubscription()
    expect(schemaAccepts('subscription', subscription)).toBe(true)
    const mismatchedPayment = structuredClone(subscription)
    const mismatchedPlan = (mismatchedPayment.plans as SchemaObject[])[0]
    mismatchedPlan.paymentTime = 'life_time'
    expect(schemaAccepts('subscription', mismatchedPayment)).toBe(false)

    const usage = validUsageMeter()
    expect(schemaAccepts('usage-based', usage)).toBe(true)
    const invalidUsageUnit = structuredClone(usage)
    const meter = (invalidUsageUnit.meters as SchemaObject[])[0]
    meter.productType = 'workflow_action'
    meter.customPriceType = 'fixed'
    meter.usageUnit = 'message'
    delete meter.pricingPageUrl
    const tier = (meter.tiers as SchemaObject[])[0]
    delete tier.minPricePerUnit
    delete tier.maxPricePerUnit
    expect(schemaAccepts('usage-based', invalidUsageUnit)).toBe(false)
  })
})

describe('writeJsonSchemaWorkspace', () => {
  it('writes deterministic local schemas and creates VS Code associations once', async () => {
    const directory = await workspace()
    const first = await writeJsonSchemaWorkspace(directory)

    expect(first.schemaFiles).toEqual(
      JSON_SCHEMA_NAMES.map(name => path.join(directory, JSON_SCHEMA_RELATIVE_PATHS[name]))
    )
    for (const name of JSON_SCHEMA_NAMES) {
      const file = path.join(directory, JSON_SCHEMA_RELATIVE_PATHS[name])
      await expect(fs.readFile(file, 'utf8')).resolves.toBe(`${JSON.stringify(getJsonSchema(name), null, 2)}\n`)
      expect((await fs.stat(file)).mode & 0o777).toBe(0o644)
    }

    const settingsFile = path.join(directory, '.vscode', 'settings.json')
    expect(first.vscodeSettingsFile).toBe(settingsFile)
    expect(first.vscodeSettingsCreated).toBe(true)
    expect(JSON.parse(await fs.readFile(settingsFile, 'utf8'))).toEqual({
      'json.schemas': JSON_SCHEMA_NAMES.map(name => ({
        fileMatch: expect.any(Array),
        url: `./${JSON_SCHEMA_RELATIVE_PATHS[name].split(path.sep).join('/')}`
      }))
    })

    const customized = '{\n  "editor.tabSize": 4\n}\n'
    await fs.writeFile(settingsFile, customized)
    await fs.writeFile(first.schemaFiles[0], '{}\n')
    const second = await writeJsonSchemaWorkspace(directory)

    expect(second.vscodeSettingsCreated).toBe(false)
    await expect(fs.readFile(settingsFile, 'utf8')).resolves.toBe(customized)
    await expect(fs.readFile(first.schemaFiles[0], 'utf8')).resolves.toBe(
      `${JSON.stringify(getJsonSchema('app'), null, 2)}\n`
    )
  })

  it('rejects a symbolic-link schema directory without changing its target', async () => {
    const directory = await workspace()
    const target = await workspace()
    await fs.mkdir(path.join(directory, '.ghl'))
    await fs.symlink(target, path.join(directory, '.ghl', 'schemas'))

    await expect(writeJsonSchemaWorkspace(directory)).rejects.toThrow(/schema directory.*symbolic link/i)
    await expect(fs.readdir(target)).resolves.toEqual([])
  })
})

describe('schema references', () => {
  it('uses paths relative to each generated JSON file', () => {
    expect(JSON_SCHEMA_REFERENCES).toEqual({
      app: './.ghl/schemas/ghl-app.schema.json',
      webhooks: '../../.ghl/schemas/ghl-webhooks.schema.json',
      'workflow-action': '../../../../.ghl/schemas/ghl-workflow-action.schema.json',
      'workflow-trigger': '../../../../.ghl/schemas/ghl-workflow-trigger.schema.json',
      subscription: '../../.ghl/schemas/ghl-subscription.schema.json',
      'usage-based': '../../.ghl/schemas/ghl-usage-based.schema.json'
    })
  })
})

describe('JSON Schema parity with the CLI validators', () => {
  it('accepts ordinary decimal prices instead of applying floating-point multipleOf checks', () => {
    const usage = validUsageMeter()
    const tier = ((usage.meters as SchemaObject[])[0].tiers as SchemaObject[])[0]
    tier.pricePerUnit = 199.99
    tier.minPricePerUnit = 67.123456
    tier.maxPricePerUnit = 131.03081
    expect(validateJsonSchema('usage-based', usage, 'usage-based.json')).toEqual([])

    const subscription = validSubscription()
    ;(subscription.plans as SchemaObject[])[0].amount = 1_234_567.89
    expect(validateJsonSchema('subscription', subscription, 'subscription.json')).toEqual([])
  })

  it('checks only the URL scheme so WHATWG-valid URLs are not rejected by the RFC 3986 format', () => {
    const action = validWorkflowAction()
    const version = (action.versions as SchemaObject[])[0]
    version.executionConfig = {
      type: 'API',
      url: 'https://api.example.com/items?fields[]=id&filter={"a":1}',
      method: 'POST'
    }
    ;(version.info as SchemaObject).screenshots = ['https://cdn.example.com/スクリーン.png']
    expect(validateJsonSchema('workflow-action', action, 'send-message.json')).toEqual([])

    version.executionConfig = { type: 'API', url: 'ftp://api.example.com/items', method: 'POST' }
    expect(validateJsonSchema('workflow-action', action, 'send-message.json')).toEqual([
      'send-message.json.versions[0].executionConfig.url does not match the required format.'
    ])
  })

  it('keeps catalog memberships and conditional rules out of structural validation', () => {
    const manifest = validAppManifest()
    ;(manifest.basicInfo as SchemaObject).subcategory = ['CRM']
    const billing = manifest.billing as SchemaObject
    billing.hasFreeTrial = true
    billing.freeTrialDuration = null

    expect(validateJsonSchemaStructure('app', manifest, 'ghl-app.json')).toEqual([])
    expect(schemaAccepts('app', manifest)).toBe(false)

    billing.billingType = 'bogus'
    expect(validateJsonSchemaStructure('app', manifest, 'ghl-app.json')).toEqual([
      'ghl-app.json.billing.billingType must be one of: "free", "freemium", "paid".'
    ])
  })

  it('does not require optional portal fields that main tolerated', () => {
    const subscription = validSubscription()
    const plan = (subscription.plans as SchemaObject[])[0]
    plan.freeForLocation = true
    delete plan.locationAmount
    expect(validateJsonSchema('subscription', subscription, 'subscription.json')).toEqual([])

    const action = validWorkflowAction()
    const version = (action.versions as SchemaObject[])[0]
    version.payloadCustomizationType = 'custom'
    version.customizedPayload = { contact: '{{contact.id}}' }
    delete version.executionConfig
    expect(validateJsonSchema('workflow-action', action, 'send-message.json')).toEqual([])

    const input = (version.inputs as SchemaObject[])[0]
    input.validations = [{ rule: `(value) => value.length < ${'9'.repeat(1_200)}`, errorMessage: 'Too long.' }]
    expect(validateJsonSchema('workflow-action', action, 'send-message.json')).toEqual([])
  })

  it('reports one actionable message per problem with readable types and property names', () => {
    const action = validWorkflowAction()
    const version = (action.versions as SchemaObject[])[0]
    const input = (version.inputs as SchemaObject[])[0]
    delete input.options
    version.executionConfig = {
      type: 'API',
      url: 'https://api.example.com/send',
      method: 'POST',
      codeFile: 'code/send_message.1.0.js',
      headers: { 'bad header': 'value' }
    }

    const errors = validateJsonSchema('workflow-action', action, 'send-message.json')
    expect(errors).toEqual(
      expect.arrayContaining([
        'send-message.json.versions[0].inputs[0] must match exactly one supported configuration.',
        'send-message.json.versions[0].executionConfig.codeFile is not supported here.',
        'send-message.json.versions[0].executionConfig.headers["bad header"] is not a supported property name.'
      ])
    )
    expect(errors).not.toEqual(expect.arrayContaining([expect.stringMatching(/mappedTo is required/)]))
    expect(errors).not.toEqual(expect.arrayContaining([expect.stringMatching(/does not match the required format/)]))
    expect(errors).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/contains a value that is not supported/)])
    )

    const usage = validUsageMeter()
    const tier = ((usage.meters as SchemaObject[])[0].tiers as SchemaObject[])[0]
    tier.maxVolume = 'unlimited'
    tier.executionLimitPerCycle = 1.5
    expect(validateJsonSchema('usage-based', usage, 'usage-based.json')).toEqual([
      'usage-based.json.meters[0].tiers[0].maxVolume must be a number or null.',
      'usage-based.json.meters[0].tiers[0].executionLimitPerCycle must be an integer.'
    ])
  })
})
