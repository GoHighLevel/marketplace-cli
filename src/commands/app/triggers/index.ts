import { WorkflowTriggerCommands } from '../../../lib/workflows/triggers/commands.js'

export default class AppTriggers extends WorkflowTriggerCommands.List {
  static description = 'List workflow triggers registered for an app'

  static examples = [
    '<%= config.bin %> app triggers',
    '<%= config.bin %> app triggers --app 67ee6752f753647b1c9ae06e --json'
  ]
}
