import { WorkflowTriggerCommands } from '../../../lib/workflows/triggers/commands.js'

export default class AppTriggersValidate extends WorkflowTriggerCommands.Validate {
  static description = 'Validate local workflow trigger JSON without calling an API'

  static examples = [
    '<%= config.bin %> app triggers validate',
    '<%= config.bin %> app triggers validate --publishable --trigger order_created --version 1.0'
  ]
}
