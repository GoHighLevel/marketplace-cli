import { Flags } from '@oclif/core'

import { MCP_CLIENT_IDS, MCP_CLIENTS, MCP_SERVER_NAME, type McpClientId, mcpClient } from '../../lib/mcp/clients.js'
import {
  buildLaunchCommand,
  DEFAULT_NPM_REGISTRY,
  formatLaunchCommand,
  isEphemeralInstall,
  validateCliVersion,
  validateRegistry
} from '../../lib/mcp/launch.js'
import {
  defaultRegistrationDependencies,
  detectInstalledClients,
  registerMcpClient,
  type RegistrationDependencies,
  type RegistrationResult
} from '../../lib/mcp/registration.js'
import { GhlCommand } from '../../lib/shared/command.js'
import { checkbox } from '../../lib/shared/prompts.js'
import { withSpinner } from '../../lib/shared/spinner.js'

const STANDALONE_ONLY_FLAGS = ['cli-version', 'registry'] as const

export default class McpSetup extends GhlCommand {
  static description = `Register the ${MCP_SERVER_NAME} MCP server with AI coding clients (Claude Code, Codex CLI, Cursor, Gemini CLI, VS Code, Windsurf)`

  static examples = [
    '<%= config.bin %> mcp setup',
    '<%= config.bin %> mcp setup --client claude --client cursor',
    '<%= config.bin %> mcp setup --client codex --standalone --cli-version 1.2.0',
    '<%= config.bin %> mcp setup --client cursor --standalone --registry https://npm.example.com/'
  ]

  static enableJsonFlag = true

  static flags = {
    client: Flags.option({
      description: 'Client to configure; repeat for several. Required when running non-interactively.',
      options: MCP_CLIENT_IDS,
      multiple: true
    })(),
    standalone: Flags.boolean({
      description:
        'Launch the server through npx instead of this installation. Defaults to on when the CLI itself runs through a package runner such as npx.',
      allowNo: true
    }),
    'cli-version': Flags.string({
      description: 'CLI version npx runs in standalone mode: an exact version or "latest". Defaults to this version.'
    }),
    registry: Flags.string({
      description: `npm registry npx installs from in standalone mode. Defaults to ${DEFAULT_NPM_REGISTRY}; set it for a private mirror.`
    })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(McpSetup)
    const standalone = flags.standalone ?? isEphemeralInstall(this.config.root)
    const misplaced = STANDALONE_ONLY_FLAGS.filter(flag => flags[flag] !== undefined)
    if (misplaced.length > 0 && !standalone) this.error(`--${misplaced.join(' and --')} requires --standalone.`)
    const version = flags['cli-version'] ? validateCliVersion(flags['cli-version']) : this.config.version
    const registry = flags.registry ? validateRegistry(flags.registry) : DEFAULT_NPM_REGISTRY

    const dependencies = defaultRegistrationDependencies()
    const clients = await this.selectClients(flags.client, dependencies)
    const launch = buildLaunchCommand({
      root: this.config.root,
      execPath: process.execPath,
      platform: process.platform,
      standalone,
      packageName: this.config.pjson.name,
      binName: this.config.bin,
      version,
      registry
    })

    const results = await withSpinner(
      'Configuring MCP clients',
      () => Promise.all(clients.map(id => registerMcpClient(mcpClient(id), MCP_SERVER_NAME, launch, dependencies))),
      { quiet: this.jsonEnabled() }
    )
    if (results.some(outcome => outcome.status === 'failed')) process.exitCode = 1

    if (this.jsonEnabled()) return { server: MCP_SERVER_NAME, standalone, launch, results }
    this.report(results, formatLaunchCommand(launch))
    return undefined
  }

  private async selectClients(
    requested: McpClientId[] | undefined,
    dependencies: RegistrationDependencies
  ): Promise<McpClientId[]> {
    if (requested?.length) return [...new Set(requested)]
    if (!process.stdin.isTTY || this.jsonEnabled()) {
      this.error(`Pass --client (${MCP_CLIENT_IDS.join(', ')}) when running non-interactively.`)
    }

    const installed = new Set(await detectInstalledClients(MCP_CLIENTS, dependencies))
    return checkbox<McpClientId>({
      message: `Configure ${MCP_SERVER_NAME} for:`,
      required: true,
      choices: MCP_CLIENTS.map(client => ({
        name: installed.has(client.id) ? client.label : `${client.label} (not detected)`,
        value: client.id,
        checked: installed.has(client.id)
      }))
    })
  }

  private report(results: readonly RegistrationResult[], launch: string): void {
    const width = Math.max(...results.map(outcome => outcome.label.length))
    this.log(`${MCP_SERVER_NAME} → ${launch}`)
    for (const outcome of results) {
      const mark = outcome.status === 'configured' ? '✓' : '✖'
      this.log(`  ${mark} ${outcome.label.padEnd(width)}  ${outcome.message ?? outcome.target}`)
    }
    if (results.some(outcome => outcome.status === 'configured')) {
      this.log('Restart running clients to load the server. In Claude Code, run /mcp to check its status.')
    }
  }
}
