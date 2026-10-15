import { getConfig } from '../../lib/config/environment.js'
import { MCP_SERVER_NAME } from '../../lib/mcp/clients.js'
import { createMarketplaceMcpServer, serveOverStdio } from '../../lib/mcp/server.js'
import { GhlCommand } from '../../lib/shared/command.js'

export default class McpStart extends GhlCommand {
  static description = `Run the ${MCP_SERVER_NAME} MCP server over stdio; AI clients start it after \`ghl mcp setup\``

  static examples = ['<%= config.bin %> mcp start']

  /* stdout is the JSON-RPC channel, so this command never logs to it. */
  protected async execute(): Promise<void> {
    await serveOverStdio(createMarketplaceMcpServer(getConfig()))
  }
}
