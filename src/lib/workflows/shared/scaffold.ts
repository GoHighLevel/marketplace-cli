import {
  type WorkflowResource,
  type WorkflowResourceManifest,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from './resource.js'

export const WORKFLOW_KEY_PATTERN = /^[a-z][_a-z0-9]*$/
export const WORKFLOW_KEY_RULE = 'Use lowercase letters, numbers, and underscores, starting with a letter.'

export interface WorkflowScaffoldInput {
  name: string
  key: string
  /* Workflow actions only: a typed handler transpiled when pushing. */
  typescript?: boolean
}

export interface WorkflowScaffoldResult {
  appId: string
  key: string
  name: string
  /* The scaffold's first version, such as "1.0". */
  version: string
  file: string
  /* What the rest of the workspace still needs before this can be pushed. */
  prerequisites: string[]
}

/* Adds one draft item to the local workspace. Nothing reaches the portal
   until the resource is pushed. */
export async function scaffoldWorkflowItem<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(
  resource: WorkflowResource<M, P, W, F, S>,
  workspace: W,
  input: WorkflowScaffoldInput
): Promise<WorkflowScaffoldResult> {
  const name = input.name.trim()
  const key = input.key.trim()
  if (!name) throw new Error(`The ${resource.singular} name is required.`)
  if (!WORKFLOW_KEY_PATTERN.test(key))
    throw new Error(`Invalid ${resource.singular} key "${key}". ${WORKFLOW_KEY_RULE}`)
  const options = input.typescript ? { typescript: true } : undefined
  const manifest = options
    ? resource.withScaffold(workspace.manifest, name, key, options)
    : resource.withScaffold(workspace.manifest, name, key)
  const errors = resource.validateManifest(manifest)
  if (errors.length > 0) throw new Error(`${resource.label} is invalid:\n- ${errors.join('\n- ')}`)
  const staged = options
    ? await resource.writeStagedSources(workspace, manifest, options)
    : await resource.writeStagedSources(workspace, manifest)
  const file = staged.files.find(candidate => candidate.endsWith(resource.filenameFromKey(key)))
  if (!file) throw new Error(`The workflow ${resource.singular} file for "${key}" was not written.`)
  const version = resource.items(manifest).find(item => item.key === key)?.versions[0]?.version ?? ''
  const prerequisites = resource.prerequisiteErrors({ ...workspace, manifest })
  return { appId: manifest.appId, key, name, version, file, prerequisites }
}
