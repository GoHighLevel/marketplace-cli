import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { validateLocalBillingIntent } from '../../../src/lib/billing/command-context.js'
import { type BillingWorkspace } from '../../../src/lib/billing/workspace.js'

const directories: string[] = []

async function billingWorkspace(): Promise<BillingWorkspace> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-billing-context-'))
  directories.push(directory)
  const app = {
    appId: 'app-1',
    versionId: 'version-1',
    status: 'draft',
    appType: 'standard',
    listing: {
      private: true,
      userTypes: ['Location'],
      isWhiteLabelFriendly: false,
      isAgencyBulkInstallEnabled: false,
      searchKeywords: []
    },
    billing: {
      billingType: 'free' as const,
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
    }
  }
  await fs.writeFile(path.join(directory, 'ghl-app.json'), JSON.stringify(app))
  const subscriptions = {
    schemaVersion: 1 as const,
    appId: 'app-1',
    plans: [
      {
        id: 'plan-1',
        name: 'Legacy plan',
        features: ['Existing feature'],
        paymentTime: 'month' as const,
        paymentType: 'recurring' as const,
        amount: 5,
        locationAmount: 5,
        freePlan: false,
        freeForAgency: false,
        freeForLocation: false
      }
    ]
  }
  const usage = { schemaVersion: 1 as const, appId: 'app-1', meters: [] }
  return {
    directory,
    app,
    subscriptions,
    usage,
    state: {
      schemaVersion: 1,
      appId: 'app-1',
      subscriptionBaseline: structuredClone(subscriptions),
      usageBaseline: structuredClone(usage)
    },
    billingDirectory: path.join(directory, 'src', 'billing'),
    stateFile: path.join(directory, '.ghl', 'billing-state.json')
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('billing command context', () => {
  it('accepts unchanged legacy portal plans but applies current rules to local edits', async () => {
    const workspace = await billingWorkspace()

    expect(await validateLocalBillingIntent(workspace)).toEqual([])

    workspace.subscriptions.plans[0].features.push('Local edit')
    expect(await validateLocalBillingIntent(workspace)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/requires the app to target both agencies and sub-accounts/i),
        expect.stringMatching(/billing model is free/i)
      ])
    )
  })
})
