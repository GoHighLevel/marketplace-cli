import type { ApiClient } from '../../api/client.js'
import { errorMessage } from '../../shared/errors.js'
import { loadWorkflowSyncContext, workflowPlanError, type WorkflowSyncContext } from './context.js'
import {
  type WorkflowResource,
  type WorkflowResourceExecution,
  type WorkflowResourceManifest,
  workflowOperationLabel,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from './resource.js'

const VERIFICATION_MISMATCH = 'The portal state did not match the requested configuration after the API call.'

export interface WorkflowPushOutcome<F> {
  execution: WorkflowResourceExecution
  files: F
}

interface OperationOutcome {
  operation: string
  success: boolean
  error?: string
}

interface Execution<R extends OperationOutcome> {
  total: number
  succeeded: number
  failed: number
  applied: string[]
  results: R[]
}

/* Operations whose API call succeeded but whose portal state does not match
   the request are reported as failures so the local baseline stays honest. */
export function withVerificationMismatches<R extends OperationOutcome, E extends Execution<R>>(
  execution: E,
  mismatches: Set<string>
): E {
  const results = execution.results.map(result =>
    result.success && mismatches.has(result.operation)
      ? { ...result, success: false, error: VERIFICATION_MISMATCH }
      : result
  )
  const applied = results.filter(result => result.success).map(result => result.operation)
  return { ...execution, succeeded: applied.length, failed: execution.total - applied.length, applied, results }
}

/* Validates the local files and plans the three-way sync; conflicts and
   invalid configuration stop the push before any API call. */
export async function planWorkflowPush<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  directory: string,
  client?: ApiClient
): Promise<WorkflowSyncContext<M, P, W, S>> {
  const context = await loadWorkflowSyncContext(resource, directory, { requirePrerequisites: true, client })
  const planError = workflowPlanError(resource, context.plan)
  if (planError) throw planError
  return context
}

/* Applies a planned push, verifies the portal, and rewrites the local files
   and baseline to match what actually succeeded. */
export async function applyWorkflowPush<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  context: WorkflowSyncContext<M, P, W, S>
): Promise<WorkflowPushOutcome<F>> {
  const execution = await resource.executePlan(context.client, context.plan, context.runtime)
  try {
    const remote =
      execution.total > 0 ? (await resource.fetchSnapshot(context.client, context.appId)).manifest : context.remote
    const successful = new Set(execution.results.filter(result => result.success).map(result => result.operation))
    const verificationPlan = {
      ...context.plan,
      operations: context.plan.operations.filter(operation => successful.has(workflowOperationLabel(operation)))
    }
    const verified = withVerificationMismatches(execution, new Set(resource.verifyApplied(verificationPlan, remote)))
    const failedKeys = new Set(verified.results.filter(result => !result.success).map(result => result.key))
    const local = resource.reconcileAfterPush(context.local.manifest, remote, failedKeys)
    const files = resource.preserveSourceWorkspace
      ? await resource.writeWorkspace(context.directory, local, remote, context.local)
      : await resource.writeWorkspace(context.directory, local, remote)
    return { execution: verified, files }
  } catch (error) {
    throw new Error(
      `The workflow ${resource.singular} API push completed, but verification or local synchronization failed: ` +
        `${errorMessage(error, 'local synchronization failed')}. Run \`ghl app ${resource.plural} pull\` before making more changes.`
    )
  }
}
