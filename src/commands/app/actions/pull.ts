import { WorkflowActionCommands } from '../../../lib/workflows/actions/commands.js'

export default class AppActionsPull extends WorkflowActionCommands.Pull {
  static description = 'Pull workflow actions while preserving compatible TypeScript and reporting conflicts'

  static examples = [
    '<%= config.bin %> app actions pull',
    '<%= config.bin %> app actions pull --force',
    '<%= config.bin %> app actions pull --directory ./my-app --json'
  ]
}
