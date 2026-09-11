import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsValidate extends WorkflowActionCommands.Validate {
  static description = 'Validate local workflow action JSON and referenced JavaScript without calling an API'

  static examples = [
    '<%= config.bin %> app actions validate',
    '<%= config.bin %> app actions validate --publishable --action send_message --version 1.0'
  ]
}
