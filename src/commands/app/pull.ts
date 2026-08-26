import { Args, Command, Flags } from '@oclif/core'

import { ApiClient } from '../../lib/api/client.js'
import { findAppItemById, persistSelection, toSelectedApp } from '../../lib/app/context.js'
import {
  loadAppVersionForExport,
  readPullWorkspaceBinding,
  resolvePullWorkspaceBinding,
  resolveVersionId
} from '../../lib/app/pull.js'
import { writeAppWorkspace } from '../../lib/app/workspace.js'
import { getConfig } from '../../lib/config/environment.js'
import { getSelectedApp } from '../../lib/config/selection-store.js'
import { fetchBillingSnapshot } from '../../lib/billing/service.js'
import {
  assertBillingWorkspaceWritable,
  synchronizeUsageBillingSummary,
  writeBillingWorkspace
} from '../../lib/billing/workspace.js'
import { isPromptCancel } from '../../lib/shared/prompts.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { collectWorkspaceDirectory } from '../../lib/shared/workspace-input.js'
import { fetchWorkflowActionsManifest } from '../../lib/workflows/actions/service.js'
import { validateWorkflowActionsManifest } from '../../lib/workflows/actions/schema.js'
import {
  assertWorkflowActionsWorkspaceWritable,
  writeWorkflowActionsWorkspace
} from '../../lib/workflows/actions/workspace.js'
import { fetchWorkflowTriggersManifest } from '../../lib/workflows/triggers/service.js'
import { validateWorkflowTriggersManifest } from '../../lib/workflows/triggers/schema.js'
import {
  assertWorkflowTriggersWorkspaceWritable,
  writeWorkflowTriggersWorkspace
} from '../../lib/workflows/triggers/workspace.js'

export default class AppPull extends Command {
  static description = 'Pull an app version into the current workspace or a new local folder'

  static examples = [
    '<%= config.bin %> app pull 67ee6752f753647b1c9ae06e',
    '<%= config.bin %> app pull',
    '<%= config.bin %> app pull --version 1.2.0 --directory ./apps',
    '<%= config.bin %> app pull 67ee6752f753647b1c9ae06e --folder acme-app --json'
  ]

  static enableJsonFlag = true

  static args = {
    appId: Args.string({
      description: 'App id to pull (defaults to the current workspace or selected app)',
      required: false
    })
  }

  static flags = {
    version: Flags.string({ description: 'Version id or semantic version (defaults to the selected app version)' }),
    directory: Flags.string({ description: 'Parent directory for the app folder (default: current directory)' }),
    folder: Flags.string({ description: 'App folder name (default: app-name slug)' })
  }

  async run(): Promise<unknown> {
    const { args, flags } = await this.parse(AppPull)
    const interactive = process.stdin.isTTY === true && !this.jsonEnabled()
    const config = getConfig()
    const client = new ApiClient(config)

    try {
      const hasExplicitDestination = flags.directory !== undefined || flags.folder !== undefined
      const workspaceBinding = hasExplicitDestination
        ? undefined
        : resolvePullWorkspaceBinding(
            await readPullWorkspaceBinding(process.cwd()),
            args.appId
          )
      const pulled = await withSpinner(
        'Loading app...',
        async () => {
          await client.init()
          const selected = workspaceBinding
            ? {
                appId: workspaceBinding.appId,
                versionId: workspaceBinding.versionId,
                name: workspaceBinding.name
              }
            : args.appId
              ? toSelectedApp(await findAppItemById(client, args.appId))
              : await getSelectedApp(config.configDir, client.activeProfileName)
          if (!selected) {
            throw new Error('No app selected. Pass an app id (`ghl app pull <appId>`) or run `ghl app use` first.')
          }
          const versions = await client.listVersions(selected.appId)
          const versionId = resolveVersionId(versions, flags.version, selected.versionId)
          const [version, workflowActions, workflowTriggers, billing] = await Promise.all([
            loadAppVersionForExport(client, selected.appId, versionId),
            fetchWorkflowActionsManifest(client, selected.appId),
            fetchWorkflowTriggersManifest(client, selected.appId),
            fetchBillingSnapshot(client, selected.appId)
          ])
          return { selected, version, workflowActions, workflowTriggers, billing }
        },
        { quiet: this.jsonEnabled() }
      )

      const directory =
        workspaceBinding?.directory ??
        (await collectWorkspaceDirectory({
          appId: pulled.selected.appId,
          appName: pulled.version.name ?? pulled.selected.name ?? pulled.selected.appId,
          flags,
          interactive
        }))
      const actionErrors = validateWorkflowActionsManifest(pulled.workflowActions, {
        whiteLabel: pulled.version.isWhiteLabelFriendly !== false
      })
      if (actionErrors.length > 0) {
        throw new Error(`Workflow action configuration is invalid:\n- ${actionErrors.join('\n- ')}`)
      }
      const triggerErrors = validateWorkflowTriggersManifest(pulled.workflowTriggers, {
        whiteLabel: pulled.version.isWhiteLabelFriendly !== false
      })
      if (triggerErrors.length > 0) {
        throw new Error(`Workflow trigger configuration is invalid:\n- ${triggerErrors.join('\n- ')}`)
      }
      if (workspaceBinding) {
        await Promise.all([
          assertWorkflowActionsWorkspaceWritable(directory, pulled.workflowActions),
          assertWorkflowTriggersWorkspaceWritable(directory, pulled.workflowTriggers),
          assertBillingWorkspaceWritable(
            directory,
            pulled.billing.subscriptions,
            pulled.billing.usage
          )
        ])
      }
      const workspace = await withSpinner(
        'Writing app files...',
        async () => {
          const appFiles = await writeAppWorkspace({ directory, version: pulled.version })
          const actionFiles = await writeWorkflowActionsWorkspace(directory, pulled.workflowActions)
          const triggerFiles = await writeWorkflowTriggersWorkspace(directory, pulled.workflowTriggers)
          const billingFiles = await writeBillingWorkspace(
            directory,
            pulled.billing.subscriptions,
            pulled.billing.usage
          )
          await synchronizeUsageBillingSummary(directory, pulled.billing.usage.meters.length > 0)
          const { stateFile: workflowActionStateFile, ...actionOutput } = actionFiles
          return {
            ...appFiles,
            ...(pulled.workflowActions.actions.length > 0 ? { ...actionOutput, workflowActionStateFile } : {}),
            ...(pulled.workflowTriggers.triggers.length > 0 ? triggerFiles : {}),
            ...(pulled.billing.subscriptions.plans.length > 0 || pulled.billing.usage.meters.length > 0
              ? billingFiles
              : {})
          }
        },
        { quiet: this.jsonEnabled() }
      )
      const selected = {
        ...pulled.selected,
        versionId: pulled.version._id,
        name: pulled.version.name ?? pulled.selected.name ?? pulled.selected.appId
      }
      try {
        await persistSelection(client, config, selected)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Selection update failed.'
        throw new Error(`App files were written to "${workspace.directory}", but selection could not be saved: ${reason}`)
      }

      if (this.jsonEnabled()) {
        return {
          app: {
            appId: selected.appId,
            versionId: selected.versionId,
            version: pulled.version.version ?? null,
            status: pulled.version.status ?? null,
            name: selected.name
          },
          files: workspace
        }
      }

      this.log(`Pulled "${selected.name}" to ${workspace.directory}`)
      this.log(`  App:      ${workspace.appFile}`)
      if (workspace.webhookFile) this.log(`  Webhooks: ${workspace.webhookFile}`)
      if (pulled.workflowActions.actions.length > 0) this.log(`  Actions:  ${workspace.actionDirectory}`)
      if (pulled.workflowTriggers.triggers.length > 0) this.log(`  Triggers: ${workspace.triggerDirectory}`)
      if (pulled.billing.subscriptions.plans.length > 0) this.log(`  Plans:    ${workspace.subscriptionFile}`)
      if (pulled.billing.usage.meters.length > 0) this.log(`  Meters:   ${workspace.usageFile}`)
      this.log(`Selected version ${selected.versionId}; subsequent commands will target it.`)
      return
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to pull app files')
    }
  }
}
