import type { ApiClient } from '../api/client.js'
import { errorMessage } from '../shared/errors.js'
import { withVerificationMismatches } from '../workflows/shared/push.js'
import { billingPlanError, type BillingSyncContext, loadBillingSyncContext } from './command-context.js'
import {
  type BillingExecutionResult,
  billingSubscriptionOperationLabel,
  billingUsageOperationLabel,
  executeBillingSyncPlans,
  fetchBillingSnapshot,
  reconcileBillingAfterPush,
  verifyBillingOperations
} from './service.js'
import { type BillingWorkspaceResult, synchronizeUsageBillingSummary, writeBillingWorkspace } from './workspace.js'

export interface BillingPushPlan {
  context: BillingSyncContext
  /* API operations in apply order, such as `create-plan:Pro`. */
  operations: string[]
}

export interface BillingPushOutcome {
  execution: BillingExecutionResult
  files: BillingWorkspaceResult
}

/* Validates the billing files and plans the three-way sync; conflicts and
   invalid plans stop the push before any API call. */
export async function planBillingPush(directory: string, client?: ApiClient): Promise<BillingPushPlan> {
  const context = await loadBillingSyncContext(directory, client)
  const planError = billingPlanError(context.subscriptionPlan, context.usagePlan)
  if (planError) throw planError
  return {
    context,
    operations: [
      ...context.subscriptionPlan.operations.map(billingSubscriptionOperationLabel),
      ...context.usagePlan.operations.map(billingUsageOperationLabel)
    ]
  }
}

/* Applies a planned billing push, verifies the portal, and rewrites the
   local files and baseline to match what actually succeeded. */
export async function applyBillingPush(context: BillingSyncContext): Promise<BillingPushOutcome> {
  const { subscriptionPlan, usagePlan } = context
  const execution = await executeBillingSyncPlans(context.client, subscriptionPlan, usagePlan)
  try {
    const remote = execution.total > 0 ? await fetchBillingSnapshot(context.client, context.appId) : context.remote
    const succeeded = new Set(execution.results.filter(result => result.success).map(result => result.operation))
    const mismatches = new Set(
      verifyBillingOperations(
        {
          ...subscriptionPlan,
          operations: subscriptionPlan.operations.filter(operation =>
            succeeded.has(billingSubscriptionOperationLabel(operation))
          )
        },
        {
          ...usagePlan,
          operations: usagePlan.operations.filter(operation => succeeded.has(billingUsageOperationLabel(operation)))
        },
        remote
      )
    )
    const verified = withVerificationMismatches(execution, mismatches)
    const failed = new Set(verified.results.filter(result => !result.success).map(result => result.operation))
    const local = reconcileBillingAfterPush(
      { subscriptions: context.local.subscriptions, usage: context.local.usage },
      remote,
      subscriptionPlan,
      usagePlan,
      failed
    )
    const files = await writeBillingWorkspace(context.directory, local.subscriptions, local.usage, remote)
    await synchronizeUsageBillingSummary(context.directory, remote.usage.meters.length > 0)
    return { execution: verified, files }
  } catch (error) {
    throw new Error(
      `The billing API push completed, but verification or local synchronization failed: ${errorMessage(error, 'local synchronization failed')}. ` +
        'Run `ghl app billing pull` before making more changes.'
    )
  }
}
