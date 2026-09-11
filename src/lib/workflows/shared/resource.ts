import { type ApiClient } from '../../api/client.js'

export interface WorkflowResourceManifest {
  schemaVersion: 1
  appId: string
}

export interface WorkflowResourceVersion {
  version: string
  status: string
  info: { name: string }
}

export interface WorkflowResourceDefinition {
  templateId?: string
  key: string
  versions: WorkflowResourceVersion[]
}

export interface WorkflowResourceWorkspace<TManifest> {
  directory: string
  manifest: TManifest
  state: { baseline: TManifest }
}

export interface WorkflowResourceOperation {
  type: 'create' | 'update' | 'delete'
  key: string
  version?: string
}

export interface WorkflowResourcePlan {
  appId: string
  localChanges: string[]
  remoteChanges: string[]
  conflicts: string[]
  errors: string[]
  operations: WorkflowResourceOperation[]
}

export interface WorkflowResourceOperationResult {
  operation: string
  type: WorkflowResourceOperation['type']
  key: string
  success: boolean
  error?: string
}

export interface WorkflowResourceExecution {
  total: number
  succeeded: number
  failed: number
  applied: string[]
  results: WorkflowResourceOperationResult[]
}

export interface WorkflowResourceSnapshot<TManifest, TSummary> {
  manifest: TManifest
  runtime: TManifest
  summaries: TSummary[]
}

export interface WorkflowResourcePublishCandidate {
  item: WorkflowResourceDefinition
  version: WorkflowResourceVersion
  repairRegistry: boolean
}

export interface WorkflowResourceSummaryRow {
  id: string
  name: string
  version: string
  status: string
}

export interface WorkflowResourceStagedFiles {
  directory: string
  files: string[]
}

export interface WorkflowResourceValidationOptions {
  publishable?: boolean
  key?: string
  version?: string
}

export interface WorkflowResourceNaming {
  /* Lower-case noun used in flags, arguments, messages, and JSON keys: "action". */
  singular: string
  /* Command topic and manifest collection: "actions". */
  plural: string
  /* Sentence-case label for messages: "Workflow action". */
  label: string
}

/* Everything the shared `ghl app <actions|triggers> ...` commands need to know
   about one versioned workflow resource. Each concrete resource supplies its
   manifest type (M), sync plan (P), local workspace (W), written-files result
   (F), and registry summary (S); the command layer never inspects them beyond
   the structural minimums declared above. */
export interface WorkflowResource<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
> extends WorkflowResourceNaming {
  items(manifest: M): WorkflowResourceDefinition[]
  withScaffold(manifest: M, name: string, key: string): M
  withoutItem(manifest: M, key: string): M
  filenameFromKey(key: string): string
  loadWorkspace(directory: string): Promise<W>
  /* Writes the JSON sources while keeping the last-pull baseline untouched. */
  writeStagedSources(workspace: W, manifest: M): Promise<WorkflowResourceStagedFiles>
  writeWorkspace(directory: string, manifest: M, baseline?: M): Promise<F>
  filesDirectory(files: F): string
  /* The subset of written files reported when the resource has no items. */
  stateFiles(files: F): Partial<F>
  validateManifest(manifest: M, options?: WorkflowResourceValidationOptions): string[]
  prerequisiteErrors(workspace: W): string[]
  fetchSnapshot(client: ApiClient, appId: string): Promise<WorkflowResourceSnapshot<M, S>>
  planSync(baseline: M, local: M, remote: M): P
  listSummaries(client: ApiClient, appId: string): Promise<S[]>
  summaryRow(summary: S): WorkflowResourceSummaryRow
  publishCandidates(manifest: M, summaries: S[], version?: string): WorkflowResourcePublishCandidate[]
  executePlan(client: ApiClient, plan: P, runtime: M): Promise<WorkflowResourceExecution>
  verifyApplied(plan: P, remote: M): string[]
  reconcileAfterPush(local: M, remote: M, failedKeys: Set<string>): M
  createVersion(client: ApiClient, appId: string, templateId: string): Promise<{ version: string }>
  submitForReview(client: ApiClient, appId: string, templateId: string, version: string, notes: string): Promise<void>
  publishSummary(client: ApiClient, appId: string, templateId: string, version: string): Promise<void>
}

export function workflowOperationLabel(operation: WorkflowResourceOperation): string {
  return operation.type === 'update'
    ? `update:${operation.key}@${operation.version}`
    : `${operation.type}:${operation.key}`
}

export function workflowItemName(item: WorkflowResourceDefinition): string {
  return item.versions[0]?.info.name ?? item.key
}

export function hasDraftVersion(item: WorkflowResourceDefinition): boolean {
  return item.versions.some(version => version.status === 'draft')
}

export function findWorkflowItem(
  items: WorkflowResourceDefinition[],
  selector: string
): WorkflowResourceDefinition | undefined {
  return items.find(item => item.key === selector || item.templateId === selector)
}
