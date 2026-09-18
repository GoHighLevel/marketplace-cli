import { WorkflowTriggerCommands } from '../../../lib/workflows/triggers/commands.js'

export default class AppTriggersPublish extends WorkflowTriggerCommands.Publish {
  static description = 'Validate and publish a workflow trigger draft with a change log'

  static examples = [
    '<%= config.bin %> app triggers publish order_created',
    '<%= config.bin %> app triggers publish order_created --notes "Initial release" --force'
  ]
}
