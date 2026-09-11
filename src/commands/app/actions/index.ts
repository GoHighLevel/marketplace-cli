import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActions extends WorkflowActionCommands.List {
  static description = 'List workflow actions registered for an app'

  static examples = [
    '<%= config.bin %> app actions',
    '<%= config.bin %> app actions --app 67ee6752f753647b1c9ae06e --json'
  ]
}
