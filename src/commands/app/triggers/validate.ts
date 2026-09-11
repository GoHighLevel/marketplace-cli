import { Command, Flags } from '@oclif/core'

import { workflowTriggerPrerequisiteErrors } from '../../../lib/workflows/triggers/contract.js'
import { validateWorkflowTriggersManifest } from '../../../lib/workflows/triggers/schema.js'
import { loadWorkflowTriggersWorkspace } from '../../../lib/workflows/triggers/workspace.js'

export default class AppTriggersValidate extends Command {
  static description = 'Validate local workflow trigger JSON without calling an API'

  static examples = [
    '<%= config.bin %> app triggers validate',
    '<%= config.bin %> app triggers validate --publishable --trigger order_created --version 1.0'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    publishable: Flags.boolean({ description: 'Also enforce submission requirements for draft triggers' }),
    trigger: Flags.string({ description: 'Trigger key to check with --publishable', dependsOn: ['publishable'] }),
    version: Flags.string({
      description: 'Trigger version to check with --publishable',
      dependsOn: ['publishable', 'trigger']
    })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppTriggersValidate)
    try {
      const workspace = await loadWorkflowTriggersWorkspace(flags.directory)
      const errors = validateWorkflowTriggersManifest(workspace.manifest, {
        publishable: flags.publishable,
        triggerKey: flags.trigger,
        version: flags.version
      })
      errors.push(
        ...workflowTriggerPrerequisiteErrors({
          triggerCount: workspace.manifest.triggers.length,
          allowedScopes: workspace.allowedScopes,
          redirectUris: workspace.redirectUris,
          clientKeyCount: workspace.clientKeyCount,
          userTypes: workspace.userTypes
        })
      )
      if (errors.length > 0) throw new Error(`Workflow trigger configuration is invalid:\n- ${errors.join('\n- ')}`)
      const result = {
        valid: true,
        appId: workspace.manifest.appId,
        triggers: workspace.manifest.triggers.length,
        errors: []
      }
      if (this.jsonEnabled()) return result
      this.log(`Workflow trigger configuration is valid (${result.triggers} trigger(s)).`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Workflow trigger validation failed.')
    }
  }
}
