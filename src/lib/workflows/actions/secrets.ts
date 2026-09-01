import {
  isWorkflowSecretReference,
  WORKFLOW_ENV_REFERENCE,
  WORKFLOW_REMOTE_REFERENCE,
  workflowEnvironmentVariable,
  workflowHeaderRequiresReference
} from '../shared/secret-references.js'

export const WORKFLOW_ACTION_REMOTE_REFERENCE = WORKFLOW_REMOTE_REFERENCE
export const WORKFLOW_ACTION_ENV_REFERENCE = WORKFLOW_ENV_REFERENCE
export const workflowActionHeaderRequiresReference = workflowHeaderRequiresReference
export const isWorkflowActionSecretReference = isWorkflowSecretReference
export const workflowActionEnvironmentVariable = workflowEnvironmentVariable
