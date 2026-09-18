import { Flags } from '@oclif/core'

import { GhlCommand } from '../lib/shared/command.js'
import {
  buildUpdateInvocation,
  detectPackageManager,
  formatUpdateInvocation,
  MARKETPLACE_CLI_LATEST,
  PACKAGE_MANAGERS,
  type PackageManager,
  runUpdateInvocation
} from '../lib/update/service.js'

export default class Update extends GhlCommand {
  static description = 'Update the GHL Marketplace CLI to the latest published version'

  static examples = [
    '<%= config.bin %> update',
    '<%= config.bin %> update --dry-run',
    '<%= config.bin %> update --package-manager npm'
  ]

  static enableJsonFlag = true

  static flags = {
    'dry-run': Flags.boolean({ description: 'Print the package-manager command without running it', default: false }),
    'package-manager': Flags.string({
      description: 'Package manager used to update the global CLI installation',
      options: ['auto', ...PACKAGE_MANAGERS],
      default: 'auto'
    })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(Update)
    const packageManager =
      flags['package-manager'] === 'auto'
        ? detectPackageManager([process.argv[1], this.config.root], process.env.npm_config_user_agent)
        : (flags['package-manager'] as PackageManager)
    const invocation = buildUpdateInvocation(packageManager)
    const command = formatUpdateInvocation(invocation)
    const result = {
      package: MARKETPLACE_CLI_LATEST,
      currentVersion: this.config.version,
      packageManager,
      command,
      dryRun: flags['dry-run']
    }

    if (flags['dry-run']) {
      if (this.jsonEnabled()) return result
      this.log(command)
      return
    }

    if (!this.jsonEnabled()) this.log(`Updating ${MARKETPLACE_CLI_LATEST} with ${packageManager}...`)
    await runUpdateInvocation(invocation, this.jsonEnabled())

    if (this.jsonEnabled()) return { ...result, updated: true }
    this.log('Update complete. Run `ghl --version` to verify the installed version.')
    return
  }
}
