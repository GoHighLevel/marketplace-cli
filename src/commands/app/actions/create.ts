import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsCreate extends WorkflowActionCommands.Create {
  static description = 'Add a new workflow action draft as its own JSON file; run actions push to create it remotely'

  static examples = [
    '<%= config.bin %> app actions create "Send message" --key send_message',
    '<%= config.bin %> app actions create --directory ./my-app'
  ]
}
