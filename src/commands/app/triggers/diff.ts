import { WorkflowTriggerCommands } from '../../../lib/workflows/triggers/commands.js'

export default class AppTriggersDiff extends WorkflowTriggerCommands.Diff {
  static description = 'Compare local workflow triggers with the last pull and current portal state'

  static examples = [
    '<%= config.bin %> app triggers diff',
    '<%= config.bin %> app triggers diff --directory ./my-app --json'
  ]
}
