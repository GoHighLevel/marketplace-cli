import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsNewVersion extends WorkflowActionCommands.NewVersion {
  static description = 'Create a new editable draft version from a published workflow action'

  static examples = ['<%= config.bin %> app actions new-version send_message']
}
