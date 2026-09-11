import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsPull extends WorkflowActionCommands.Pull {
  static description = 'Pull every workflow action into local JSON and versioned JavaScript files'

  static examples = [
    '<%= config.bin %> app actions pull',
    '<%= config.bin %> app actions pull --directory ./my-app --json'
  ]
}
