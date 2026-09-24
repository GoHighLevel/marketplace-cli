import { WorkflowTriggerCommands } from '../../../lib/workflows/triggers/commands.js'

export default class AppTriggersPull extends WorkflowTriggerCommands.Pull {
  static description = 'Pull every workflow trigger into local JSON files'

  static examples = [
    '<%= config.bin %> app triggers pull',
    '<%= config.bin %> app triggers pull --directory ./my-app --json'
  ]
}
