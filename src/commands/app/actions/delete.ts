import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsDelete extends WorkflowActionCommands.Delete {
  static description = 'Remove a local workflow action file; run actions push to delete the remote action'

  static examples = [
    '<%= config.bin %> app actions delete send_message',
    '<%= config.bin %> app actions delete send_message --force'
  ]
}
