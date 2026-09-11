import { WorkflowTriggerCommands } from '../../../lib/workflows/triggers/commands.js'

export default class AppTriggersNewVersion extends WorkflowTriggerCommands.NewVersion {
  static description = 'Create a new editable draft version from a published workflow trigger'

  static examples = ['<%= config.bin %> app triggers new-version order_created']
}
