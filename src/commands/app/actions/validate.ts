import { Command, Flags } from '@oclif/core'

import { workflowActionPrerequisiteErrors } from '../../../lib/workflows/actions/contract.js'
import { validateWorkflowActionsManifest } from '../../../lib/workflows/actions/schema.js'
import { loadWorkflowActionsWorkspace } from '../../../lib/workflows/actions/workspace.js'

export default class AppActionsValidate extends Command {
  static description = 'Validate local workflow action JSON and referenced JavaScript without calling an API'

  static examples = [
    '<%= config.bin %> app actions validate',
    '<%= config.bin %> app actions validate --publishable --action send_message --version 1.0'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    publishable: Flags.boolean({ description: 'Also enforce submission requirements for draft actions' }),
    action: Flags.string({ description: 'Action key to check with --publishable', dependsOn: ['publishable'] }),
    version: Flags.string({
      description: 'Action version to check with --publishable',
      dependsOn: ['publishable', 'action']
    })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppActionsValidate)
    try {
      const workspace = await loadWorkflowActionsWorkspace(flags.directory)
      const errors = validateWorkflowActionsManifest(workspace.manifest, {
        publishable: flags.publishable,
        actionKey: flags.action,
        version: flags.version
      })
      errors.push(...workflowActionPrerequisiteErrors(
        workspace.allowedScopes,
        workspace.manifest.actions.length
      ))
      if (errors.length > 0) throw new Error(`Workflow action configuration is invalid:\n- ${errors.join('\n- ')}`)
      const result = { valid: true, appId: workspace.manifest.appId, actions: workspace.manifest.actions.length, errors: [] }
      if (this.jsonEnabled()) return result
      this.log(`Workflow action configuration is valid (${result.actions} action(s)).`)
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Workflow action validation failed.')
    }
  }
}
