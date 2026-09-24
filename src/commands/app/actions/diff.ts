import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsDiff extends WorkflowActionCommands.Diff {
  static description = 'Compare local workflow actions with the last pull and current portal state'

  static examples = [
    '<%= config.bin %> app actions diff',
    '<%= config.bin %> app actions diff --directory ./my-app --json'
  ]
}
