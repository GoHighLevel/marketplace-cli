import { WorkflowTriggerCommands } from '../../../lib/workflows/triggers/commands.js'

export default class AppTriggersPush extends WorkflowTriggerCommands.Push {
  static description = 'Validate all trigger files and independently push each changed workflow trigger'

  static examples = [
    '<%= config.bin %> app triggers push',
    '<%= config.bin %> app triggers push --dry-run --json',
    '<%= config.bin %> app triggers push --force'
  ]
}
