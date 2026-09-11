import { Flags } from '@oclif/core'

import { readPullWorkspaceBinding } from '../../lib/app/pull.js'
import { DEFAULT_TYPES_FILENAME, writeTypesWorkspace } from '../../lib/app/types.js'
import { GhlCommand } from '../../lib/shared/command.js'

export default class AppTypes extends GhlCommand {
  static description = 'Generate TypeScript declarations and local JSON Schemas for an app workspace'

  static examples = [
    '<%= config.bin %> app types',
    '<%= config.bin %> app types --directory ./my-app',
    '<%= config.bin %> app types --output generated/ghl-types.d.ts --json'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    output: Flags.string({
      description: `TypeScript declaration path inside the workspace (default: ${DEFAULT_TYPES_FILENAME})`,
      default: DEFAULT_TYPES_FILENAME,
      helpValue: 'file'
    })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppTypes)
    const binding = await readPullWorkspaceBinding(flags.directory)
    if (!binding) {
      throw new Error('No ghl-app.json was found. Run this command inside an app workspace or pass --directory.')
    }

    const generated = await writeTypesWorkspace(binding.directory, { output: flags.output })
    const result = {
      appId: binding.appId,
      directory: binding.directory,
      ...generated
    }
    if (this.jsonEnabled()) return result

    this.log(`Generated TypeScript declarations at ${generated.declarationFile}`)
    this.log(`Generated ${generated.schemaFiles.length} JSON Schema file(s) in ${generated.schemaDirectory}`)
    if (generated.vscodeSettingsCreated)
      this.log(`Created VS Code schema associations at ${generated.vscodeSettingsFile}`)
    return
  }
}
