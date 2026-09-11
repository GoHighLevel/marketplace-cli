import { ApiClient, type AppVersion } from '../api/client.js'
import { resolveApp } from '../app/context.js'
import { readPullWorkspaceBinding } from '../app/pull.js'
import {
  type BillingSnapshot,
  billingSubscriptionOperationLabel,
  billingUsageOperationLabel,
  fetchBillingSnapshot,
  reconcileBillingAfterPush
} from './service.js'
import {
  type BillingSubscriptionSyncPlan,
  type BillingUsageSyncPlan,
  planBillingSubscriptionSync,
  planBillingUsageSync
} from './sync.js'
import { type BillingWorkspace, loadBillingWorkspace } from './workspace.js'
import { validateBillingSubscriptionManifest, validateBillingUsageManifest } from './schema.js'
import { getConfig } from '../config/environment.js'
import { loadWorkflowActionsWorkspaceIfPresent } from '../workflows/actions/workspace.js'
import { loadWorkflowTriggersWorkspaceIfPresent } from '../workflows/triggers/workspace.js'

export interface BillingRemoteContext {
  appId: string
  versionId?: string
  client: ApiClient
  directory?: string
}

export interface BillingSyncContext extends BillingRemoteContext {
  directory: string
  local: BillingWorkspace
  remote: BillingSnapshot
  remoteVersion: AppVersion
  subscriptionPlan: BillingSubscriptionSyncPlan
  usagePlan: BillingUsageSyncPlan
}

export async function loadBillingRemoteContext(options: {
  appId?: string
  directory?: string
  requireWorkspaceMatch?: boolean
}): Promise<BillingRemoteContext> {
  const directory = options.directory ?? process.cwd()
  const binding = await readPullWorkspaceBinding(directory)
  if (options.requireWorkspaceMatch && binding && options.appId && binding.appId !== options.appId) {
    throw new Error(`The workspace belongs to app "${binding.appId}", not "${options.appId}".`)
  }
  const config = getConfig()
  const client = new ApiClient(config)
  await client.init()
  const useWorkspace = Boolean(binding && (!options.appId || binding.appId === options.appId))
  let appId: string
  let versionId: string | undefined
  if (useWorkspace && binding) {
    appId = binding.appId
    versionId = binding.versionId
  } else {
    const selected = await resolveApp(client, config, options.appId)
    appId = selected.appId
    versionId = selected.versionId
  }
  return {
    appId,
    ...(versionId ? { versionId } : {}),
    client,
    ...(binding && binding.appId === appId ? { directory: binding.directory } : {})
  }
}

async function workflowKeys(directory: string): Promise<{
  actionKeys?: Set<string>
  triggerKeys?: Set<string>
  registeredActionKeys?: Set<string>
  registeredTriggerKeys?: Set<string>
}> {
  const [actions, triggers] = await Promise.all([
    loadWorkflowActionsWorkspaceIfPresent(directory),
    loadWorkflowTriggersWorkspaceIfPresent(directory)
  ])
  return {
    ...(actions
      ? {
          actionKeys: new Set(actions.manifest.actions.map(action => action.key)),
          registeredActionKeys: new Set(actions.state.baseline.actions.map(action => action.key))
        }
      : {}),
    ...(triggers
      ? {
          triggerKeys: new Set(triggers.manifest.triggers.map(trigger => trigger.key)),
          registeredTriggerKeys: new Set(triggers.state.baseline.triggers.map(trigger => trigger.key))
        }
      : {})
  }
}

export async function validateLocalBillingIntent(
  workspace: BillingWorkspace,
  options: {
    subscriptionPlan?: BillingSubscriptionSyncPlan
    usagePlan?: BillingUsageSyncPlan
    remoteVersion?: AppVersion
    desired?: BillingSnapshot
  } = {}
): Promise<string[]> {
  const keys = await workflowKeys(workspace.directory)
  const subscriptionPlan =
    options.subscriptionPlan ??
    planBillingSubscriptionSync(
      workspace.state.subscriptionBaseline,
      workspace.subscriptions,
      workspace.state.subscriptionBaseline
    )
  const usagePlan =
    options.usagePlan ??
    planBillingUsageSync(workspace.state.usageBaseline, workspace.usage, workspace.state.usageBaseline)
  const version = options.remoteVersion
  const desired = options.desired ?? {
    subscriptions: workspace.subscriptions,
    usage: workspace.usage
  }
  const subscriptionOptions = {
    billingType: version?.billingType ?? workspace.app.billing.billingType,
    status: version?.status ?? workspace.app.status,
    appType: version?.appType ?? workspace.app.appType,
    userTypes: version?.userTypes ?? workspace.app.listing.userTypes,
    externalBilling: version?.externalBilling ?? workspace.app.billing.externalBilling,
    whiteLabel: version?.isWhiteLabelFriendly ?? workspace.app.listing.isWhiteLabelFriendly,
    mutationRequested: subscriptionPlan.operations.length > 0,
    configurationMutationRequested: subscriptionPlan.operations.some(operation => operation.type !== 'delete-plan'),
    contextual: subscriptionPlan.operations.some(operation => operation.type !== 'delete-plan')
  } as const
  const usageMutationRequested = usagePlan.operations.some(
    operation => operation.type !== 'delete-meter' && operation.type !== 'delete-tier'
  )
  const usageOptions = {
    appType: version?.appType ?? workspace.app.appType,
    externalBilling: version?.externalBilling ?? workspace.app.billing.externalBilling,
    mutationRequested: usageMutationRequested,
    contextual: usageMutationRequested,
    ...keys
  }
  const componentStateErrors: string[] = []
  if (desired.usage.meters.some(meter => meter.productType === 'workflow_action') && !keys.actionKeys) {
    componentStateErrors.push(
      'Workflow action meters require synchronized action state; run `ghl app actions pull` first.'
    )
  }
  if (desired.usage.meters.some(meter => meter.productType === 'workflow_trigger') && !keys.triggerKeys) {
    componentStateErrors.push(
      'Workflow trigger meters require synchronized trigger state; run `ghl app triggers pull` first.'
    )
  }
  return [
    ...new Set([
      ...validateBillingSubscriptionManifest(desired.subscriptions, subscriptionOptions),
      ...validateBillingUsageManifest(desired.usage, usageOptions),
      ...componentStateErrors,
      ...subscriptionPlan.errors,
      ...usagePlan.errors
    ])
  ]
}

export async function loadBillingSyncContext(directory: string): Promise<BillingSyncContext> {
  const local = await loadBillingWorkspace(directory)
  const localErrors = await validateLocalBillingIntent(local)
  if (localErrors.length > 0) {
    throw new Error(`Billing configuration is invalid:\n- ${localErrors.join('\n- ')}`)
  }
  const config = getConfig()
  const client = new ApiClient(config)
  await client.init()
  const [remote, remoteVersion] = await Promise.all([
    fetchBillingSnapshot(client, local.app.appId),
    client.getVersion(local.app.appId, local.app.versionId)
  ])
  const subscriptionPlan = planBillingSubscriptionSync(
    local.state.subscriptionBaseline,
    local.subscriptions,
    remote.subscriptions
  )
  const usagePlan = planBillingUsageSync(local.state.usageBaseline, local.usage, remote.usage)
  const pendingOperations = new Set([
    ...subscriptionPlan.operations.map(billingSubscriptionOperationLabel),
    ...usagePlan.operations.map(billingUsageOperationLabel)
  ])
  const desired = reconcileBillingAfterPush(
    { subscriptions: local.subscriptions, usage: local.usage },
    remote,
    subscriptionPlan,
    usagePlan,
    pendingOperations
  )
  const errors = await validateLocalBillingIntent(local, {
    subscriptionPlan,
    usagePlan,
    remoteVersion,
    desired
  })
  if (errors.length > 0) {
    subscriptionPlan.errors = [...new Set([...subscriptionPlan.errors, ...errors])].sort()
    subscriptionPlan.operations = []
    usagePlan.operations = []
  }
  return {
    appId: local.app.appId,
    client,
    directory: local.directory,
    local,
    remote,
    remoteVersion,
    subscriptionPlan,
    usagePlan
  }
}

export function billingPlanError(
  subscriptionPlan: BillingSubscriptionSyncPlan,
  usagePlan: BillingUsageSyncPlan
): Error | undefined {
  const errors = [...subscriptionPlan.errors, ...usagePlan.errors]
  if (errors.length > 0)
    return new Error(`Billing configuration cannot be pushed:\n- ${[...new Set(errors)].join('\n- ')}`)
  const conflicts = [...subscriptionPlan.conflicts, ...usagePlan.conflicts]
  if (conflicts.length > 0) {
    return new Error(
      `Billing configuration conflicts with portal changes:\n- ${[...new Set(conflicts)].join('\n- ')}\n` +
        'Run `ghl app billing pull`, reapply the local changes, and retry.'
    )
  }
  return undefined
}
