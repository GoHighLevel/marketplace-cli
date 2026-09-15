import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsCreate extends WorkflowActionCommands.Create {
  static description = 'Add a workflow action draft, optionally with a typed handler; push creates it remotely'

  static examples = [
    '<%= config.bin %> app actions create "Send message" --key send_message',
    '<%= config.bin %> app actions create "Calculate score" --key calculate_score --typescript',
    '<%= config.bin %> app actions create --directory ./my-app'
  ]
}
