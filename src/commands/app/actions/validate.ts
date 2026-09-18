import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsValidate extends WorkflowActionCommands.Validate {
  static description = 'Validate action JSON and compile referenced JavaScript or TypeScript without calling an API'

  static examples = [
    '<%= config.bin %> app actions validate',
    '<%= config.bin %> app actions validate --publishable --action send_message --version 1.0'
  ]
}
