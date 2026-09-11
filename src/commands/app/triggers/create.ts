import { WorkflowTriggerCommands } from '../../../lib/workflows/triggers/commands.js'

export default class AppTriggersCreate extends WorkflowTriggerCommands.Create {
  static description = 'Add a new workflow trigger draft as its own JSON file; run triggers push to create it remotely'

  static examples = [
    '<%= config.bin %> app triggers create "Order created" --key order_created',
    '<%= config.bin %> app triggers create --directory ./my-app'
  ]
}
