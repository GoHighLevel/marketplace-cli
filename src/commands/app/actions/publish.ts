import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsPublish extends WorkflowActionCommands.Publish {
  static description = 'Validate and publish a workflow action draft with a change log'

  static examples = [
    '<%= config.bin %> app actions publish send_message',
    '<%= config.bin %> app actions publish send_message --notes "Initial release" --force'
  ]
}
