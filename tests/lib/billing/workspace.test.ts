import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  BillingSubscriptionManifest,
  BillingUsageManifest
} from '../../../src/lib/billing/manifest.js'
import {
  BILLING_DIRECTORY_RELATIVE_PATH,
  BILLING_GUIDE_FILENAME,
  BILLING_STATE_RELATIVE_PATH,
  BILLING_SUBSCRIPTION_RELATIVE_PATH,
  BILLING_USAGE_RELATIVE_PATH,
  loadBillingWorkspace,
  synchronizeUsageBillingSummary,
  writeBillingWorkspace,
  writeLocalBillingWorkspace
} from '../../../src/lib/billing/workspace.js'

const directories: string[] = []

async function createWorkspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-billing-workspace-'))
  directories.push(directory)
  await fs.writeFile(path.join(directory, 'ghl-app.json'), JSON.stringify({
    schemaVersion: 1,
    appId: 'app-1',
    versionId: 'version-1',
    status: 'draft',
    appType: 'standard',
    listing: { userTypes: ['company', 'location'], isWhiteLabelFriendly: false },
    billing: { billingType: 'paid', externalBilling: false }
  }))
  return directory
}

function subscriptions(): BillingSubscriptionManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    plans: [{
      id: 'plan-1',
      name: 'Pro',
      features: [],
      paymentTime: 'month',
      paymentType: 'recurring',
      amount: 10,
      freePlan: false,
      freeForAgency: false,
      freeForLocation: false
    }]
  }
}

function usage(): BillingUsageManifest {
  return {
    schemaVersion: 1,
    appId: 'app-1',
    meters: [{
      id: 'meter-1',
      productType: 'custom',
      productId: 'custom_exports',
      productName: 'Exports',
      customPriceType: 'fixed',
      usageUnit: 'export',
      tiers: [{
        id: 'tier-1',
        name: 'Exports',
        minVolume: 0,
        maxVolume: null,
        pricePerUnit: 0.01,
        executionLimitPerCycle: 100
      }]
    }]
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('billing workspaces', () => {
  it('writes both manifests, a guide, and a private conflict baseline', async () => {
    const directory = await createWorkspace()
    const result = await writeBillingWorkspace(directory, subscriptions(), usage())

    expect(result.billingDirectory).toBe(path.join(directory, BILLING_DIRECTORY_RELATIVE_PATH))
    expect(result.subscriptionFile).toBe(path.join(directory, BILLING_SUBSCRIPTION_RELATIVE_PATH))
    expect(result.usageFile).toBe(path.join(directory, BILLING_USAGE_RELATIVE_PATH))
    expect(result.guideFile).toBe(path.join(result.billingDirectory, BILLING_GUIDE_FILENAME))
    expect((await fs.stat(result.stateFile)).mode & 0o777).toBe(0o600)
    expect(await fs.readFile(result.guideFile as string, 'utf8')).toMatch(/immutable.*amount.*duration|amount.*paymentTime.*immutable/is)

    const loaded = await loadBillingWorkspace(path.join(directory, 'src', 'billing'))
    expect(loaded.subscriptions).toEqual(subscriptions())
    expect(loaded.usage).toEqual(usage())
    expect(loaded.state.subscriptionBaseline).toEqual(subscriptions())
    expect(loaded.state.usageBaseline).toEqual(usage())
  })

  it('imports a legacy dynamic meter without weakening later mutation validation', async () => {
    const directory = await createWorkspace()
    const legacyUsage = usage()
    legacyUsage.meters[0].customPriceType = 'dynamic'
    legacyUsage.meters[0].tiers[0].minPricePerUnit = 0.005
    legacyUsage.meters[0].tiers[0].maxPricePerUnit = 0.02

    await writeBillingWorkspace(directory, subscriptions(), legacyUsage)

    const loaded = await loadBillingWorkspace(directory)
    expect(loaded.usage).toEqual(legacyUsage)
    expect(loaded.state.usageBaseline).toEqual(legacyUsage)
  })

  it('persists a validated resource change without reapplying contextual rules to legacy resources', async () => {
    const directory = await createWorkspace()
    const appFile = path.join(directory, 'ghl-app.json')
    const app = JSON.parse(await fs.readFile(appFile, 'utf8'))
    app.listing.userTypes = ['Location']
    app.billing.billingType = 'free'
    await fs.writeFile(appFile, JSON.stringify(app))
    const legacySubscriptions = subscriptions()
    legacySubscriptions.plans[0].locationAmount = 10
    await writeBillingWorkspace(directory, legacySubscriptions, {
      schemaVersion: 1,
      appId: 'app-1',
      meters: []
    })

    await expect(writeLocalBillingWorkspace(directory, legacySubscriptions, usage())).resolves.toMatchObject({
      subscriptionFile: path.join(directory, BILLING_SUBSCRIPTION_RELATIVE_PATH),
      usageFile: path.join(directory, BILLING_USAGE_RELATIVE_PATH)
    })

    const invalidUsage = usage()
    invalidUsage.meters[0].productId = ''
    await expect(writeLocalBillingWorkspace(directory, legacySubscriptions, invalidUsage)).rejects.toThrow(/productId must be a non-empty string/i)
  })

  it('omits empty source files and removes generated files after a later pull', async () => {
    const directory = await createWorkspace()
    await writeBillingWorkspace(directory, subscriptions(), usage())
    const result = await writeBillingWorkspace(
      directory,
      { schemaVersion: 1, appId: 'app-1', plans: [] },
      { schemaVersion: 1, appId: 'app-1', meters: [] }
    )

    await expect(fs.stat(path.join(directory, BILLING_DIRECTORY_RELATIVE_PATH))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(directory, BILLING_SUBSCRIPTION_RELATIVE_PATH))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(directory, BILLING_USAGE_RELATIVE_PATH))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(result.subscriptionFile).toBeUndefined()
    expect(result.usageFile).toBeUndefined()
    expect((await fs.stat(path.join(directory, BILLING_STATE_RELATIVE_PATH))).mode & 0o777).toBe(0o600)
  })

  it('discovers a manually created billing file while retaining an empty baseline', async () => {
    const directory = await createWorkspace()
    await writeBillingWorkspace(
      directory,
      { schemaVersion: 1, appId: 'app-1', plans: [] },
      { schemaVersion: 1, appId: 'app-1', meters: [] }
    )
    await fs.mkdir(path.join(directory, BILLING_DIRECTORY_RELATIVE_PATH), { recursive: true })
    await fs.writeFile(path.join(directory, BILLING_SUBSCRIPTION_RELATIVE_PATH), JSON.stringify(subscriptions()))

    const loaded = await loadBillingWorkspace(directory)
    expect(loaded.subscriptions.plans).toHaveLength(1)
    expect(loaded.state.subscriptionBaseline.plans).toEqual([])
  })

  it('directs older workspaces to pull before staging billing changes', async () => {
    const directory = await createWorkspace()
    await expect(loadBillingWorkspace(directory)).rejects.toThrow(/billing pull.*before editing/i)
  })

  it('rejects app binding mismatches and symbolic links', async () => {
    const directory = await createWorkspace()
    await writeBillingWorkspace(directory, subscriptions(), usage())
    const subscriptionFile = path.join(directory, BILLING_SUBSCRIPTION_RELATIVE_PATH)
    await fs.unlink(subscriptionFile)
    await fs.symlink(path.join(directory, 'ghl-app.json'), subscriptionFile)
    await expect(loadBillingWorkspace(directory)).rejects.toThrow(/symbolic link/i)
  })

  it('updates only the derived usage summary in app JSON and its conflict baseline', async () => {
    const directory = await createWorkspace()
    const appFile = path.join(directory, 'ghl-app.json')
    const app = JSON.parse(await fs.readFile(appFile, 'utf8'))
    app.billing.hasUsageBasedPrice = false
    app.basicInfo = { name: 'Local pending name' }
    const webhooks = {
      schemaVersion: 1,
      appId: 'app-1',
      versionId: 'version-1',
      webhookUrl: '',
      subscribedEvents: []
    }
    const state = {
      schemaVersion: 1,
      appId: 'app-1',
      versionId: 'version-1',
      baseline: {
        app: { ...structuredClone(app), basicInfo: { name: 'Portal name' } },
        webhooks
      }
    }
    await fs.mkdir(path.join(directory, '.ghl'), { recursive: true })
    await Promise.all([
      fs.writeFile(appFile, JSON.stringify(app)),
      fs.writeFile(path.join(directory, '.ghl', 'state.json'), JSON.stringify(state))
    ])

    await synchronizeUsageBillingSummary(directory, true)
    const updatedApp = JSON.parse(await fs.readFile(appFile, 'utf8'))
    const updatedState = JSON.parse(await fs.readFile(path.join(directory, '.ghl', 'state.json'), 'utf8'))
    expect(updatedApp.basicInfo.name).toBe('Local pending name')
    expect(updatedApp.billing.hasUsageBasedPrice).toBe(true)
    expect(updatedState.baseline.app.basicInfo.name).toBe('Portal name')
    expect(updatedState.baseline.app.billing.hasUsageBasedPrice).toBe(true)
  })
})
