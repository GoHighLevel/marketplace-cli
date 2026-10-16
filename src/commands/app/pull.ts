import path from 'node:path'

import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { errorMessage } from '../../lib/shared/errors.js'
import { ApiClient } from '../../lib/api/client.js'
import { persistSelection } from '../../lib/app/context.js'
import { readPullWorkspaceBinding, resolvePullWorkspaceBinding } from '../../lib/app/pull.js'
import {
  loadPullSnapshot,
  preparePullDestination,
  pulledSelection,
  writePulledWorkspace
} from '../../lib/app/workspace-pull.js'
import { getConfig } from '../../lib/config/environment.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { collectWorkspaceDirectory } from '../../lib/shared/workspace-input.js'
import type { TypeScriptConfigResult } from '../../lib/app/types.js'

export default class AppPull extends GhlCommand {
  static description = 'Pull an app version into the current workspace or a new local folder'

  static examples = [
    '<%= config.bin %> app pull 67ee6752f753647b1c9ae06e',
    '<%= config.bin %> app pull',
    '<%= config.bin %> app pull --with-types',
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
    folder: Flags.string({ description: 'App folder name (default: app-name slug)' }),
    'with-types': Flags.boolean({
      description: 'Generate TypeScript declarations and project configuration',
      default: false
    }),
    force: Flags.boolean({
      description: 'Discard local workflow-action changes and replace conflicts with portal JavaScript',
      default: false
    })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppPull)
    const interactive = process.stdin.isTTY === true && !this.jsonEnabled()
    const config = getConfig()
    const client = new ApiClient(config)

    const hasExplicitDestination = flags.directory !== undefined || flags.folder !== undefined
    const workspaceBinding = hasExplicitDestination
      ? undefined
      : resolvePullWorkspaceBinding(await readPullWorkspaceBinding(process.cwd()), args.appId)
    const pulled = await withSpinner(
      'Loading app...',
      async () => {
        await client.init()
        return loadPullSnapshot(client, config, {
          workspace: workspaceBinding,
          appId: args.appId,
          version: flags.version
        })
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
    const options = { refresh: workspaceBinding !== undefined, force: flags.force, withTypes: flags['with-types'] }
    const existingActions = await preparePullDestination(directory, pulled, options)
    const workspace = await withSpinner(
      'Writing app files...',
      () => writePulledWorkspace(directory, pulled, existingActions, options),
      { quiet: this.jsonEnabled() }
    )
    const selected = pulledSelection(pulled)
    try {
      await persistSelection(client, config, selected)
    } catch (error) {
      const reason = errorMessage(error, 'Selection update failed.')
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
    this.log(`  Schemas:  ${path.join(workspace.directory as string, '.ghl', 'schemas')}`)
    if (flags['with-types']) {
      const typescriptConfig = workspace.typescriptConfig as TypeScriptConfigResult
      this.log(`  Types:    ${workspace.declarationFile}`)
      this.log(`  TSConfig: ${typescriptConfig.file}`)
    }
    this.log(`Selected version ${selected.versionId}; subsequent commands will target it.`)
  }
}
