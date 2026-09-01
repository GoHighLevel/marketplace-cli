import { Command, Flags } from '@oclif/core'

import { loadValidatedLocalWorkspace } from '../../lib/app/sync-context.js'
import { validateLocalBillingIntent } from '../../lib/billing/command-context.js'
import { loadBillingWorkspaceIfPresent } from '../../lib/billing/workspace.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { loadWorkflowActionsWorkspaceIfPresent } from '../../lib/workflows/actions/workspace.js'
import { workflowTriggerPrerequisiteErrors } from '../../lib/workflows/triggers/contract.js'
import { loadWorkflowTriggersWorkspaceIfPresent } from '../../lib/workflows/triggers/workspace.js'

/* Maps backend readiness fields to the CLI command that fixes them. */
const FIX_HINTS: Record<string, string> = {
  name: 'ghl app basic-info --name',
  tagline: 'ghl app basic-info --tagline',
  userTypes: 'ghl app listing --target',
  logo: 'ghl app media upload <file> --logo',
  supportDetails: 'ghl app support --email',
  category: 'ghl app basic-info --category',
  description: 'ghl app profiles --description',
  previewImages: 'ghl app media upload <3+ files>',
  subAccountDescription: 'ghl app profiles --sub-description',
  subAccountPreviewImages: 'ghl app media upload <3+ files> --profile sub-account',
  scopes: 'ghl app scopes add <scope...>',
  redirectUri: 'ghl app redirect add <url>',
  clientKeys: 'ghl app keys create <name>',
  mcpUrl: 'not configurable in this CLI yet; use the developer portal',
  externalAuth: 'not configurable in this CLI yet; use the developer portal',
  externalAuthConfig: 'not configurable in this CLI yet; use the developer portal'
}

export default class AppValidate extends Command {
  static description = 'Validate local app JSON before pushing it to the developer portal'

  static examples = [
    '<%= config.bin %> app validate',
    '<%= config.bin %> app validate --directory ./my-app',
    '<%= config.bin %> app validate --remote --app 67ee6752f753647b1c9ae06e'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    remote: Flags.boolean({ description: 'Run the server-side publish-readiness validation instead' }),
    app: Flags.string({ description: 'App id for --remote (defaults to the selected app)', dependsOn: ['remote'] })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppValidate)
    try {
      if (!flags.remote) {
        const workspace = await loadValidatedLocalWorkspace(flags.directory)
        const [workflowActions, workflowTriggers, billing] = await Promise.all([
          loadWorkflowActionsWorkspaceIfPresent(flags.directory),
          loadWorkflowTriggersWorkspaceIfPresent(flags.directory),
          loadBillingWorkspaceIfPresent(flags.directory)
        ])
        const triggerErrors = workflowTriggers
          ? workflowTriggerPrerequisiteErrors({
              triggerCount: workflowTriggers.manifest.triggers.length,
              allowedScopes: workflowTriggers.allowedScopes,
              redirectUris: workflowTriggers.redirectUris,
              clientKeyCount: workflowTriggers.clientKeyCount,
              userTypes: workflowTriggers.userTypes
            })
          : []
        if (triggerErrors.length > 0) {
          throw new Error(`Workflow trigger prerequisites are not satisfied:\n- ${triggerErrors.join('\n- ')}`)
        }
        const billingErrors = billing ? await validateLocalBillingIntent(billing) : []
        if (billingErrors.length > 0) {
          throw new Error(`Billing configuration is invalid:\n- ${billingErrors.join('\n- ')}`)
        }
        const result = {
          valid: true,
          directory: workspace.directory,
          sections: workspace.validation.sections,
          workflowActions: workflowActions?.manifest.actions.length ?? 0,
          workflowTriggers: workflowTriggers?.manifest.triggers.length ?? 0,
          subscriptionPlans: billing?.subscriptions.plans.length ?? 0,
          usageMeters: billing?.usage.meters.length ?? 0,
          errors: []
        }
        if (this.jsonEnabled()) return result
        this.log(
          `Local app configuration is valid (${workspace.validation.sections.length} app section(s), ` +
            `${result.workflowActions} workflow action(s), ${result.workflowTriggers} workflow trigger(s), ` +
            `${result.subscriptionPlans} subscription plan(s), ${result.usageMeters} usage meter(s)).`
        )
        return
      }

      const context = await loadAppContext(flags.app, this.jsonEnabled())
      const validation = await withSpinner(
        'Validating publish readiness...',
        () => context.client.preSubmitValidation(context.selected.appId, context.selected.versionId),
        { quiet: this.jsonEnabled() }
      )

      const missing = Object.entries(validation.mandatoryFields ?? {}).filter(([, valid]) => !valid)
      if (this.jsonEnabled()) {
        if (!validation.success || missing.length > 0) process.exitCode = 1
        return validation
      }

      if (!validation.success || !validation.mandatoryFields) {
        this.error(validation.message ?? 'Remote validation could not run; confirm that the selected version is a draft.')
      }

      const entries = Object.entries(validation.mandatoryFields)
      for (const [field, ok] of entries) {
        const hint = !ok && FIX_HINTS[field] ? `  -> ${FIX_HINTS[field]}` : ''
        this.log(`  ${ok ? '[x]' : '[ ]'} ${field}${hint}`)
      }
      if (missing.length === 0) {
        this.log('\nAll remote publish-readiness checks passed.')
      } else {
        this.error(`${missing.length} requirement(s) are missing before this app can be published.`)
      }
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Validation failed')
    }
  }
}
