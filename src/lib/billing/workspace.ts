import { promises as fs } from 'node:fs'
import path from 'node:path'

import { isRecord } from '../api/response.js'
import { writeTextFileAtomic } from '../shared/atomic-file.js'
import { writeWorkspaceDocumentation } from '../app/instructions.js'
import { readLocalAppWorkspace } from '../app/local-workspace.js'
import { type AppManifest } from '../app/manifest.js'
import { readPullWorkspaceBinding } from '../app/pull.js'
import { APP_MANIFEST_FILENAME } from '../app/workspace.js'
import { BILLING_GUIDE_FILENAME, buildBillingGuide } from './guide.js'
import {
  type BillingSubscriptionManifest,
  type BillingUsageManifest,
  emptyBillingSubscriptionManifest,
  emptyBillingUsageManifest
} from './manifest.js'
import {
  type BillingSubscriptionValidationOptions,
  type BillingUsageValidationOptions,
  validateBillingSubscriptionManifest,
  validateBillingUsageManifest
} from './schema.js'
import { readJsonFile, writeJsonFileAtomic } from '../shared/json-file.js'
import { removeEmptyDirectoryTree, removeRegularFileIfPresent } from '../shared/workspace-files.js'
import { withJsonSchemaReference, withoutJsonSchemaReference, writeJsonSchemaWorkspace } from '../app/json-schema.js'

export { BILLING_GUIDE_FILENAME }
export const BILLING_DIRECTORY_RELATIVE_PATH = path.join('src', 'billing')
export const BILLING_SUBSCRIPTION_RELATIVE_PATH = path.join(BILLING_DIRECTORY_RELATIVE_PATH, 'subscription.json')
export const BILLING_USAGE_RELATIVE_PATH = path.join(BILLING_DIRECTORY_RELATIVE_PATH, 'usage-based.json')
export const BILLING_STATE_RELATIVE_PATH = path.join('.ghl', 'billing-state.json')

export interface BillingState {
  schemaVersion: 1
  appId: string
  subscriptionBaseline: BillingSubscriptionManifest
  usageBaseline: BillingUsageManifest
}

export interface BillingWorkspace {
  directory: string
  app: Pick<AppManifest, 'appId' | 'versionId' | 'status' | 'appType' | 'listing' | 'billing'>
  subscriptions: BillingSubscriptionManifest
  usage: BillingUsageManifest
  state: BillingState
  billingDirectory: string
  subscriptionFile?: string
  usageFile?: string
  guideFile?: string
  stateFile: string
}

export interface BillingWorkspaceResult {
  billingDirectory: string
  subscriptionFile?: string
  usageFile?: string
  guideFile?: string
  stateFile: string
}

interface BillingBinding {
  directory: string
  app: BillingWorkspace['app']
  subscriptionOptions: BillingSubscriptionValidationOptions
  usageOptions: BillingUsageValidationOptions
}

async function lstatIfPresent(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function requireSafeRegularFile(filePath: string, label: string, optional = false): Promise<boolean> {
  const fileStat = await lstatIfPresent(filePath)
  if (!fileStat) {
    if (optional) return false
    throw new Error(`${label} "${filePath}" does not exist.`)
  }
  if (fileStat.isSymbolicLink()) throw new Error(`${label} "${filePath}" cannot be a symbolic link.`)
  if (!fileStat.isFile()) throw new Error(`${label} "${filePath}" is not a regular file.`)
  return true
}

async function requireSafeDirectory(directory: string, label: string, optional = false): Promise<boolean> {
  const directoryStat = await lstatIfPresent(directory)
  if (!directoryStat) {
    if (optional) return false
    throw new Error(`${label} "${directory}" does not exist.`)
  }
  if (directoryStat.isSymbolicLink()) throw new Error(`${label} "${directory}" cannot be a symbolic link.`)
  if (!directoryStat.isDirectory()) throw new Error(`${label} "${directory}" is not a directory.`)
  return true
}

async function loadBinding(inputDirectory: string): Promise<BillingBinding> {
  const workspace = await readPullWorkspaceBinding(inputDirectory)
  if (!workspace) {
    throw new Error(
      `No ${APP_MANIFEST_FILENAME} was found in "${path.resolve(inputDirectory)}" or a parent directory. ` +
        'Run this command inside an app workspace or pass `--directory <app-folder>`.'
    )
  }
  const appFile = path.join(workspace.directory, APP_MANIFEST_FILENAME)
  const value = await readJsonFile<unknown>(appFile)
  if (!isRecord(value)) throw new Error(`App manifest "${appFile}" must contain a JSON object.`)
  const listing = isRecord(value.listing) ? value.listing : undefined
  const billing = isRecord(value.billing) ? value.billing : undefined
  const errors: string[] = []
  if (typeof value.status !== 'string' || !value.status) errors.push('status')
  if (typeof value.appType !== 'string' || !value.appType) errors.push('appType')
  if (!listing || !Array.isArray(listing.userTypes) || !listing.userTypes.every(item => typeof item === 'string')) {
    errors.push('listing.userTypes')
  }
  if (!listing || typeof listing.isWhiteLabelFriendly !== 'boolean') errors.push('listing.isWhiteLabelFriendly')
  if (!billing || !['free', 'paid', 'freemium'].includes(String(billing.billingType)))
    errors.push('billing.billingType')
  if (!billing || typeof billing.externalBilling !== 'boolean') errors.push('billing.externalBilling')
  if (errors.length > 0) {
    throw new Error(`App manifest is missing billing prerequisites: ${errors.join(', ')}. Run \`ghl app pull\` again.`)
  }
  const app = {
    appId: workspace.appId,
    versionId: workspace.versionId,
    status: value.status as string,
    appType: value.appType as string,
    listing: listing as unknown as AppManifest['listing'],
    billing: billing as unknown as AppManifest['billing']
  }
  return {
    directory: workspace.directory,
    app,
    subscriptionOptions: {
      billingType: app.billing.billingType,
      status: app.status,
      appType: app.appType,
      userTypes: app.listing.userTypes,
      externalBilling: app.billing.externalBilling,
      whiteLabel: app.listing.isWhiteLabelFriendly
    },
    usageOptions: {
      appType: app.appType,
      externalBilling: app.billing.externalBilling
    }
  }
}

function assertManifestAppIds(
  binding: BillingBinding,
  subscriptions: BillingSubscriptionManifest,
  usage: BillingUsageManifest
): void {
  const errors: string[] = []
  if (subscriptions.appId !== binding.app.appId) {
    errors.push(`subscription.json belongs to app "${subscriptions.appId}", not "${binding.app.appId}".`)
  }
  if (usage.appId !== binding.app.appId) {
    errors.push(`usage-based.json belongs to app "${usage.appId}", not "${binding.app.appId}".`)
  }
  if (errors.length > 0) throw new Error(`Billing configuration is invalid:\n- ${errors.join('\n- ')}`)
}

function validateManifests(binding: BillingBinding, subscriptions: unknown, usage: unknown, contextual = true): void {
  const errors = [
    ...validateBillingSubscriptionManifest(subscriptions, {
      ...binding.subscriptionOptions,
      contextual
    }),
    ...validateBillingUsageManifest(usage, {
      ...binding.usageOptions,
      contextual
    })
  ]
  if (errors.length > 0) throw new Error(`Billing configuration is invalid:\n- ${errors.join('\n- ')}`)
}

async function assertBillingPathsSafe(binding: BillingBinding): Promise<void> {
  await requireSafeDirectory(binding.directory, 'App workspace')
  const billingDirectory = path.join(binding.directory, BILLING_DIRECTORY_RELATIVE_PATH)
  if (await requireSafeDirectory(billingDirectory, 'Billing directory', true)) {
    const entries = await fs.readdir(billingDirectory, { withFileTypes: true })
    for (const entry of entries) {
      const filePath = path.join(billingDirectory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Billing path "${filePath}" cannot be a symbolic link.`)
      if (entry.name.endsWith('.json') && !['subscription.json', 'usage-based.json'].includes(entry.name)) {
        throw new Error(`Billing JSON file "${filePath}" is not supported.`)
      }
    }
  }
  await Promise.all([
    requireSafeRegularFile(
      path.join(binding.directory, BILLING_SUBSCRIPTION_RELATIVE_PATH),
      'Subscription manifest',
      true
    ),
    requireSafeRegularFile(path.join(binding.directory, BILLING_USAGE_RELATIVE_PATH), 'Usage-based manifest', true),
    requireSafeRegularFile(path.join(binding.directory, BILLING_STATE_RELATIVE_PATH), 'Billing state', true)
  ])
}

async function writeBillingSources(
  binding: BillingBinding,
  subscriptions: BillingSubscriptionManifest,
  usage: BillingUsageManifest,
  contextual: boolean
): Promise<Omit<BillingWorkspaceResult, 'stateFile'>> {
  validateManifests(binding, subscriptions, usage, contextual)
  assertManifestAppIds(binding, subscriptions, usage)
  await assertBillingPathsSafe(binding)
  await writeJsonSchemaWorkspace(binding.directory)
  const billingDirectory = path.join(binding.directory, BILLING_DIRECTORY_RELATIVE_PATH)
  const subscriptionPath = path.join(binding.directory, BILLING_SUBSCRIPTION_RELATIVE_PATH)
  const usagePath = path.join(binding.directory, BILLING_USAGE_RELATIVE_PATH)
  const guidePath = path.join(billingDirectory, BILLING_GUIDE_FILENAME)
  const hasSources = subscriptions.plans.length > 0 || usage.meters.length > 0
  if (hasSources) await fs.mkdir(billingDirectory, { recursive: true, mode: 0o755 })
  if (subscriptions.plans.length > 0) {
    await writeJsonFileAtomic(subscriptionPath, withJsonSchemaReference(subscriptions, 'subscription'), 0o644)
  } else {
    await removeRegularFileIfPresent(subscriptionPath, 'Subscription manifest')
  }
  if (usage.meters.length > 0) {
    await writeJsonFileAtomic(usagePath, withJsonSchemaReference(usage, 'usage-based'), 0o644)
  } else {
    await removeRegularFileIfPresent(usagePath, 'Usage-based manifest')
  }
  if (hasSources) await writeTextFileAtomic(guidePath, buildBillingGuide())
  else await removeRegularFileIfPresent(guidePath, 'Billing guide')
  await removeEmptyDirectoryTree(billingDirectory, binding.directory)
  await writeWorkspaceDocumentation(binding.directory)
  return {
    billingDirectory,
    ...(subscriptions.plans.length > 0 ? { subscriptionFile: subscriptionPath } : {}),
    ...(usage.meters.length > 0 ? { usageFile: usagePath } : {}),
    ...(hasSources ? { guideFile: guidePath } : {})
  }
}

export async function writeBillingWorkspace(
  directory: string,
  subscriptions: BillingSubscriptionManifest,
  usage: BillingUsageManifest,
  baseline: { subscriptions: BillingSubscriptionManifest; usage: BillingUsageManifest } = { subscriptions, usage }
): Promise<BillingWorkspaceResult> {
  const binding = await loadBinding(directory)
  validateManifests(binding, baseline.subscriptions, baseline.usage, false)
  assertManifestAppIds(binding, baseline.subscriptions, baseline.usage)
  const sources = await writeBillingSources(binding, subscriptions, usage, false)
  const stateFile = path.join(binding.directory, BILLING_STATE_RELATIVE_PATH)
  const state: BillingState = {
    schemaVersion: 1,
    appId: binding.app.appId,
    subscriptionBaseline: baseline.subscriptions,
    usageBaseline: baseline.usage
  }
  await writeJsonFileAtomic(stateFile, state, 0o600)
  return { ...sources, stateFile }
}

export async function writeLocalBillingWorkspace(
  directory: string,
  subscriptions: BillingSubscriptionManifest,
  usage: BillingUsageManifest
): Promise<Omit<BillingWorkspaceResult, 'stateFile'>> {
  const binding = await loadBinding(directory)
  return writeBillingSources(binding, subscriptions, usage, false)
}

export async function assertBillingWorkspaceWritable(
  directory: string,
  subscriptions?: BillingSubscriptionManifest,
  usage?: BillingUsageManifest
): Promise<void> {
  const binding = await loadBinding(directory)
  await assertBillingPathsSafe(binding)
  if (subscriptions && usage) {
    assertManifestAppIds(binding, subscriptions, usage)
  }
}

function validateState(binding: BillingBinding, value: unknown): asserts value is BillingState {
  if (!isRecord(value)) throw new Error('.ghl/billing-state.json must contain an object.')
  const errors: string[] = []
  for (const key of Object.keys(value)) {
    if (!['schemaVersion', 'appId', 'subscriptionBaseline', 'usageBaseline'].includes(key)) {
      errors.push(`.ghl/billing-state.json.${key} is not supported.`)
    }
  }
  if (value.schemaVersion !== 1) errors.push('.ghl/billing-state.json.schemaVersion must be 1.')
  if (value.appId !== binding.app.appId) errors.push('.ghl/billing-state.json does not match this app.')
  errors.push(
    ...validateBillingSubscriptionManifest(value.subscriptionBaseline, {
      ...binding.subscriptionOptions,
      contextual: false
    }).map(error => error.replace('subscription.json', '.ghl/billing-state.json.subscriptionBaseline')),
    ...validateBillingUsageManifest(value.usageBaseline, {
      ...binding.usageOptions,
      contextual: false
    }).map(error => error.replace('usage-based.json', '.ghl/billing-state.json.usageBaseline'))
  )
  if (errors.length > 0) throw new Error(`Billing state is invalid:\n- ${errors.join('\n- ')}`)
}

export async function loadBillingWorkspace(directory: string): Promise<BillingWorkspace> {
  const binding = await loadBinding(directory)
  await assertBillingPathsSafe(binding)
  const billingDirectory = path.join(binding.directory, BILLING_DIRECTORY_RELATIVE_PATH)
  const subscriptionPath = path.join(binding.directory, BILLING_SUBSCRIPTION_RELATIVE_PATH)
  const usagePath = path.join(binding.directory, BILLING_USAGE_RELATIVE_PATH)
  const stateFile = path.join(binding.directory, BILLING_STATE_RELATIVE_PATH)
  if (!(await lstatIfPresent(stateFile))) {
    throw new Error('Billing conflict state is missing. Run `ghl app billing pull` before editing billing resources.')
  }
  await requireSafeRegularFile(stateFile, 'Billing state')
  const [subscriptionValue, usageValue, stateValue] = await Promise.all([
    readJsonFile<unknown>(subscriptionPath),
    readJsonFile<unknown>(usagePath),
    readJsonFile<unknown>(stateFile)
  ])
  const unresolvedSubscriptions = subscriptionValue
    ? withoutJsonSchemaReference(subscriptionValue)
    : emptyBillingSubscriptionManifest(binding.app.appId)
  const unresolvedUsage = usageValue
    ? withoutJsonSchemaReference(usageValue)
    : emptyBillingUsageManifest(binding.app.appId)
  validateManifests(binding, unresolvedSubscriptions, unresolvedUsage, false)
  const subscriptions = unresolvedSubscriptions as BillingSubscriptionManifest
  const usage = unresolvedUsage as BillingUsageManifest
  assertManifestAppIds(binding, subscriptions, usage)
  validateState(binding, stateValue)
  return {
    directory: binding.directory,
    app: binding.app,
    subscriptions,
    usage,
    state: stateValue,
    billingDirectory,
    ...(subscriptionValue ? { subscriptionFile: subscriptionPath } : {}),
    ...(usageValue ? { usageFile: usagePath } : {}),
    ...(subscriptionValue || usageValue ? { guideFile: path.join(billingDirectory, BILLING_GUIDE_FILENAME) } : {}),
    stateFile
  }
}

export async function loadBillingWorkspaceIfPresent(directory: string): Promise<BillingWorkspace | undefined> {
  const workspace = await readPullWorkspaceBinding(directory)
  if (!workspace) return undefined
  const paths = [BILLING_SUBSCRIPTION_RELATIVE_PATH, BILLING_USAGE_RELATIVE_PATH, BILLING_STATE_RELATIVE_PATH]
  const stats = await Promise.all(
    paths.map(relativePath => lstatIfPresent(path.join(workspace.directory, relativePath)))
  )
  if (stats.every(value => !value)) return undefined
  return loadBillingWorkspace(workspace.directory)
}

export async function synchronizeUsageBillingSummary(directory: string, hasUsageBasedPrice: boolean): Promise<void> {
  const binding = await readPullWorkspaceBinding(directory)
  if (!binding) throw new Error('Cannot synchronize usage billing because no app workspace was found.')
  const workspace = await readLocalAppWorkspace(binding.directory)
  workspace.files.app.billing.hasUsageBasedPrice = hasUsageBasedPrice
  workspace.state.baseline.app.billing.hasUsageBasedPrice = hasUsageBasedPrice
  await writeJsonSchemaWorkspace(workspace.directory)
  await Promise.all([
    writeJsonFileAtomic(workspace.appFile, withJsonSchemaReference(workspace.files.app, 'app'), 0o644),
    writeJsonFileAtomic(workspace.stateFile, workspace.state, 0o600)
  ])
}
