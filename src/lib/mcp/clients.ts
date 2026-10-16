import { platformPath } from '../shared/platform.js'

/* The name clients show for this server and prefix its tools with. */
export const MCP_SERVER_NAME = 'HighLevelMarketplaceDev'

export const MCP_CLIENT_IDS = ['claude', 'codex', 'cursor', 'gemini', 'vscode', 'windsurf'] as const

export type McpClientId = (typeof MCP_CLIENT_IDS)[number]

export interface McpLaunchCommand {
  command: string
  args: string[]
}

export interface ClientEnvironment {
  home: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
}

/* Clients that own their config through their own CLI are configured with
   it, so a running client never races with a direct file write. */
export interface CliRegistration {
  kind: 'cli'
  executable: string
  target: string
  removeArgs: (name: string) => string[]
  addArgs: (name: string, launch: McpLaunchCommand) => string[]
}

/* Clients that only read a JSON config file get one entry merged into it. */
export interface FileRegistration {
  kind: 'file'
  file: (environment: ClientEnvironment) => string
  rootKey: 'mcpServers' | 'servers'
  entry: (launch: McpLaunchCommand) => Record<string, unknown>
  /* Optional executable that proves the client is installed before its
     config directory exists. */
  executable?: string
}

export interface McpClient {
  id: McpClientId
  label: string
  registration: CliRegistration | FileRegistration
}

function homeFile(...segments: string[]): (environment: ClientEnvironment) => string {
  return ({ home, platform }) => platformPath(platform).join(home, ...segments)
}

/* Empty or relative base directories are ignored, as the XDG specification
   requires, so a config path can never resolve against the working directory. */
function absoluteDirectory(value: string | undefined, platform: NodeJS.Platform): string | undefined {
  return value && platformPath(platform).isAbsolute(value) ? value : undefined
}

/* VS Code keeps user-level MCP servers next to settings.json. */
function vsCodeUserFile({ home, env, platform }: ClientEnvironment): string {
  const api = platformPath(platform)
  if (platform === 'darwin') return api.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
  const base =
    platform === 'win32'
      ? (absoluteDirectory(env.APPDATA, platform) ?? api.join(home, 'AppData', 'Roaming'))
      : (absoluteDirectory(env.XDG_CONFIG_HOME, platform) ?? api.join(home, '.config'))
  return api.join(base, 'Code', 'User', 'mcp.json')
}

const stdioEntry = (launch: McpLaunchCommand): Record<string, unknown> => ({
  command: launch.command,
  args: launch.args
})

export const MCP_CLIENTS: readonly McpClient[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    registration: {
      kind: 'cli',
      executable: 'claude',
      target: 'claude mcp add --scope user',
      removeArgs: name => ['mcp', 'remove', '--scope', 'user', name],
      addArgs: (name, launch) => ['mcp', 'add', '--scope', 'user', name, '--', launch.command, ...launch.args]
    }
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    registration: {
      kind: 'cli',
      executable: 'codex',
      target: 'codex mcp add',
      removeArgs: name => ['mcp', 'remove', name],
      addArgs: (name, launch) => ['mcp', 'add', name, '--', launch.command, ...launch.args]
    }
  },
  {
    id: 'cursor',
    label: 'Cursor',
    registration: { kind: 'file', file: homeFile('.cursor', 'mcp.json'), rootKey: 'mcpServers', entry: stdioEntry }
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    registration: {
      kind: 'file',
      file: homeFile('.gemini', 'settings.json'),
      rootKey: 'mcpServers',
      entry: stdioEntry,
      executable: 'gemini'
    }
  },
  {
    id: 'vscode',
    label: 'VS Code',
    registration: {
      kind: 'file',
      file: vsCodeUserFile,
      rootKey: 'servers',
      entry: launch => ({ type: 'stdio', ...stdioEntry(launch) })
    }
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    registration: {
      kind: 'file',
      file: homeFile('.codeium', 'windsurf', 'mcp_config.json'),
      rootKey: 'mcpServers',
      entry: stdioEntry
    }
  }
]

export function mcpClient(id: McpClientId): McpClient {
  const client = MCP_CLIENTS.find(candidate => candidate.id === id)
  if (!client) throw new Error(`Unknown MCP client "${id}".`)
  return client
}
