import type { ApiClient } from '../../api/client.js'
import { CodedError } from '../../shared/errors.js'
import { loadWorkflowRemoteContext } from '../shared/context.js'
import { describeSecretUse, workflowSecretsToNewTargets } from '../shared/nested-headers.js'
import { workflowHeaderRequiresReference } from '../shared/secret-references.js'
import { fetchWorkflowActionsSnapshot } from './service.js'
import { assertWorkflowActionTestSucceeded, prepareWorkflowActionTestRequest } from './test-execution.js'
import { loadWorkflowActionsWorkspace } from './workspace.js'

export interface WorkflowActionTestOptions {
  directory: string
  /* Action key or template id. */
  action: string
  /* Defaults to the action's draft, or its newest local version. */
  version?: string
  inputData: Record<string, unknown>
  locationId?: string
  client?: ApiClient
  /* Called before the run when it would send header secrets to a
     destination the portal does not use today; throws to stop the run. */
  approveSecrets?: (targets: string[]) => Promise<void>
  /* Removes header secret values from the output, logs, and errors. */
  redactSecrets?: boolean
}

export interface WorkflowActionTestRun {
  appId: string
  key: string
  version: string
  type: string
  output: unknown
  consoleLogs: string[]
}

/* Runs the local, unpushed configuration of one action version through the
   portal test runner, with the portal's stored secrets filled in. */
export async function runWorkflowActionTest(options: WorkflowActionTestOptions): Promise<WorkflowActionTestRun> {
  const workspace = await loadWorkflowActionsWorkspace(options.directory)
  const action = workspace.manifest.actions.find(
    item => item.key === options.action || item.templateId === options.action
  )
  if (!action) throw new CodedError('NOT_FOUND', `Workflow action "${options.action}" was not found in this workspace.`)
  const version = options.version
    ? action.versions.find(item => item.version === options.version)
    : (action.versions.find(item => item.status === 'draft') ?? action.versions[0])
  if (!version) {
    throw new Error(
      `Workflow action "${action.key}"${options.version ? ` version ${options.version}` : ''} was not found.`
    )
  }
  const context = await loadWorkflowRemoteContext({
    appId: workspace.manifest.appId,
    directory: workspace.directory,
    requireWorkspaceMatch: true,
    client: options.client
  })
  const snapshot = await fetchWorkflowActionsSnapshot(context.client, context.appId)
  const remoteVersion = snapshot.runtime.actions
    .find(item => item.key === action.key)
    ?.versions.find(item => item.version === version.version)
  const targets = workflowSecretsToNewTargets(version, remoteVersion).map(use =>
    describeSecretUse(`action ${action.key} ${version.version}`, use)
  )
  if (targets.length > 0) await options.approveSecrets?.(targets)
  const request = prepareWorkflowActionTestRequest({
    appId: context.appId,
    inputData: options.inputData,
    locationId: options.locationId,
    version,
    remoteVersion
  })
  const secrets = options.redactSecrets ? headerSecrets(request.executionConfig.headers) : []
  let response
  try {
    response = assertWorkflowActionTestSucceeded(
      await context.client.testWorkflowAction(context.appId, request),
      request.executionConfig.type
    )
  } catch (error) {
    if (secrets.length === 0 || !(error instanceof Error)) throw error
    const message = redacted(error.message, secrets)
    throw error instanceof CodedError ? new CodedError(error.code, message) : new Error(message)
  }
  return {
    appId: context.appId,
    key: action.key,
    version: version.version,
    type: request.executionConfig.type,
    output:
      secrets.length > 0
        ? JSON.parse(redacted(JSON.stringify(response.output) ?? 'null', secrets, true))
        : response.output,
    consoleLogs: (response.consoleLogs ?? []).map(line => redacted(line, secrets))
  }
}

const MIN_REDACTED_LENGTH = 4

/* The values of credential headers, which the test runner may echo back. */
function headerSecrets(headers: ReadonlyArray<{ label: string; key: string }>): string[] {
  return headers
    .filter(header => workflowHeaderRequiresReference(header.label) && header.key.length >= MIN_REDACTED_LENGTH)
    .map(header => header.key)
}

function redacted(text: string, secrets: readonly string[], json = false): string {
  return secrets.reduce(
    (current, secret) => current.replaceAll(json ? JSON.stringify(secret).slice(1, -1) : secret, '[redacted]'),
    text
  )
}
