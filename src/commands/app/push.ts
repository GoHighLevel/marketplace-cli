import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { errorMessage } from '../../lib/shared/errors.js'
import type { AppVersion } from '../../lib/api/types.js'
import { persistSelection } from '../../lib/app/context.js'
import { buildAppFiles } from '../../lib/app/manifest.js'
import { validateLocalBillingIntent } from '../../lib/billing/command-context.js'
import { loadBillingWorkspaceIfPresent } from '../../lib/billing/workspace.js'
import { executeAppSyncPlan } from '../../lib/app/push.js'
import { validateDynamicAuthConfiguration } from '../../lib/app/push-preflight.js'
import { loadAppVersionForExport } from '../../lib/app/pull.js'
import { loadRemoteAppSyncContext, validationError } from '../../lib/app/sync-context.js'
import { validateSyncPlan, verifyAppliedChanges } from '../../lib/app/sync.js'
import { type AppWorkspaceResult, writeAppWorkspace } from '../../lib/app/workspace.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { planWorkflowActionsSync } from '../../lib/workflows/actions/sync.js'
import { loadWorkflowActionsWorkspaceIfPresent } from '../../lib/workflows/actions/workspace.js'
import { planWorkflowTriggersSync } from '../../lib/workflows/triggers/sync.js'
import { loadWorkflowTriggersWorkspaceIfPresent } from '../../lib/workflows/triggers/workspace.js'

export default class AppPush extends GhlCommand {
  static description = 'Validate and push changed local app sections to the developer portal'

  static examples = [
    '<%= config.bin %> app push',
    '<%= config.bin %> app push --directory ./my-app',
    '<%= config.bin %> app push --directory ./my-app --dry-run --json'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    'dry-run': Flags.boolean({ description: 'Validate and show the API plan without changing remote or local files' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppPush)
    const [workflowActions, workflowTriggers, billing] = await Promise.all([
      loadWorkflowActionsWorkspaceIfPresent(flags.directory),
      loadWorkflowTriggersWorkspaceIfPresent(flags.directory),
      loadBillingWorkspaceIfPresent(flags.directory)
    ])
    if (workflowActions) {
      const actionPlan = planWorkflowActionsSync(
        workflowActions.state.baseline,
        workflowActions.manifest,
        workflowActions.state.baseline
      )
      if (actionPlan.localChanges.length > 0) {
        throw new Error(
          'Local workflow action changes are pending. Run `ghl app actions validate`, ' +
            '`ghl app actions diff`, and `ghl app actions push` before pushing app configuration.'
        )
      }
    }
    if (workflowTriggers) {
      const triggerPlan = planWorkflowTriggersSync(
        workflowTriggers.state.baseline,
        workflowTriggers.manifest,
        workflowTriggers.state.baseline
      )
      if (triggerPlan.localChanges.length > 0) {
        throw new Error(
          'Local workflow trigger changes are pending. Run `ghl app triggers validate`, ' +
            '`ghl app triggers diff`, and `ghl app triggers push` before pushing app configuration.'
        )
      }
    }
    if (billing) {
      const billingErrors = await validateLocalBillingIntent(billing)
      if (billingErrors.length > 0) {
        throw new Error(`Billing configuration is invalid:\n- ${billingErrors.join('\n- ')}`)
      }
    }
    const context = await withSpinner(
      'Validating and planning app push...',
      () => loadRemoteAppSyncContext(flags.directory),
      { quiet: this.jsonEnabled() }
    )
    const validation = validateSyncPlan(context.plan, context.remoteVersion)
    if (validation.errors.length > 0) throw validationError(validation.errors)
    const dynamicErrors = await validateDynamicAuthConfiguration(context.client, context.plan)
    if (dynamicErrors.length > 0) throw validationError(dynamicErrors)

    if (flags['dry-run']) {
      const result = {
        dryRun: true,
        appId: context.plan.appId,
        versionId: context.plan.versionId,
        sections: context.plan.sections,
        changes: context.plan.localChanges
      }
      if (this.jsonEnabled()) return result
      this.log(`Validation passed. API sections: ${context.plan.sections.join(', ') || 'none'}.`)
      return
    }

    const pushed = await withSpinner(
      'Pushing app changes...',
      () => executeAppSyncPlan(context.client, context.remoteVersion, context.plan),
      { quiet: this.jsonEnabled() }
    )
    let finalVersion: AppVersion
    let workspace: AppWorkspaceResult
    try {
      finalVersion =
        pushed.appliedSections.length > 0
          ? await loadAppVersionForExport(context.client, context.plan.appId, pushed.versionId)
          : context.remoteVersion
      const finalFiles = buildAppFiles(finalVersion)
      const mismatches = verifyAppliedChanges(context.plan, finalFiles)
      if (mismatches.length > 0) {
        throw new Error(`these fields did not match after verification: ${mismatches.join(', ')}`)
      }
      workspace = await writeAppWorkspace({ directory: context.local.directory, version: finalVersion })
      await persistSelection(context.client, context.config, {
        appId: context.plan.appId,
        versionId: finalVersion._id,
        name: finalVersion.name ?? context.local.files.app.basicInfo.name
      })
    } catch (error) {
      const reason = errorMessage(error, 'local synchronization failed')
      throw new Error(
        `The API push completed, but the CLI could not verify and synchronize local state: ${reason}. ` +
          'Run `ghl app pull` before making more changes.'
      )
    }
    const result = {
      appId: context.plan.appId,
      versionId: finalVersion._id,
      appliedSections: pushed.appliedSections,
      files: workspace
    }
    if (this.jsonEnabled()) return result
    if (pushed.appliedSections.length === 0) {
      this.log('No local changes required an API update; local files are synchronized.')
    } else {
      this.log(`Pushed and verified: ${pushed.appliedSections.join(', ')}.`)
    }
  }
}
