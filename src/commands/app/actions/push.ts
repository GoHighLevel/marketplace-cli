import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsPush extends WorkflowActionCommands.Push {
  static description = 'Validate all action files and independently push each changed workflow action'

  static examples = [
    '<%= config.bin %> app actions push',
    '<%= config.bin %> app actions push --dry-run --json',
    '<%= config.bin %> app actions push --force'
  ]
}
