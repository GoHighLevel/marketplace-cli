import { WorkflowTriggerCommands } from '../../../lib/workflows/triggers/commands.js'

export default class AppTriggersDelete extends WorkflowTriggerCommands.Delete {
  static description = 'Remove a local workflow trigger file; run triggers push to delete the remote trigger'

  static examples = [
    '<%= config.bin %> app triggers delete order_created',
    '<%= config.bin %> app triggers delete order_created --force'
  ]
}
