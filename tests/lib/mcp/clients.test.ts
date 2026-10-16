import { describe, expect, it } from 'vitest'

import { MCP_CLIENT_IDS, MCP_CLIENTS, mcpClient } from '../../../src/lib/mcp/clients.js'

const LAUNCH = { command: '/usr/bin/node', args: ['/opt/ghl/bin/run.js', 'mcp', 'start'] }

function fileFor(id: (typeof MCP_CLIENT_IDS)[number], platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): string {
  const registration = mcpClient(id).registration
  if (registration.kind !== 'file') throw new Error(`${id} is not file-based`)
  return registration.file({ home: platform === 'win32' ? 'C:\\Users\\dev' : '/home/dev', env, platform })
}

describe('MCP client registry', () => {
  it('covers every supported client exactly once', () => {
    expect(MCP_CLIENTS.map(client => client.id)).toEqual([...MCP_CLIENT_IDS])
    expect(() => mcpClient('emacs' as never)).toThrow(/Unknown MCP client/)
  })

  it('registers Claude Code at user scope with the launch command after --', () => {
    const registration = mcpClient('claude').registration
    if (registration.kind !== 'cli') throw new Error('claude must use its CLI')
    expect(registration.removeArgs('Server')).toEqual(['mcp', 'remove', '--scope', 'user', 'Server'])
    expect(registration.addArgs('Server', LAUNCH)).toEqual([
      'mcp',
      'add',
      '--scope',
      'user',
      'Server',
      '--',
      '/usr/bin/node',
      '/opt/ghl/bin/run.js',
      'mcp',
      'start'
    ])
  })

  it('registers Codex through its CLI', () => {
    const registration = mcpClient('codex').registration
    if (registration.kind !== 'cli') throw new Error('codex must use its CLI')
    expect(registration.addArgs('Server', LAUNCH)).toEqual([
      'mcp',
      'add',
      'Server',
      '--',
      LAUNCH.command,
      ...LAUNCH.args
    ])
  })

  it('resolves each file-based client config on every platform', () => {
    expect(fileFor('cursor', 'linux')).toBe('/home/dev/.cursor/mcp.json')
    expect(fileFor('gemini', 'darwin')).toBe('/home/dev/.gemini/settings.json')
    expect(fileFor('windsurf', 'win32')).toBe('C:\\Users\\dev\\.codeium\\windsurf\\mcp_config.json')
    expect(fileFor('vscode', 'darwin')).toBe('/home/dev/Library/Application Support/Code/User/mcp.json')
    expect(fileFor('vscode', 'linux', { XDG_CONFIG_HOME: '/xdg' })).toBe('/xdg/Code/User/mcp.json')
    expect(fileFor('vscode', 'linux', { XDG_CONFIG_HOME: 'relative' })).toBe('/home/dev/.config/Code/User/mcp.json')
    expect(fileFor('vscode', 'win32', { APPDATA: '' })).toBe('C:\\Users\\dev\\AppData\\Roaming\\Code\\User\\mcp.json')
    expect(fileFor('vscode', 'win32', { APPDATA: 'D:\\Roaming' })).toBe('D:\\Roaming\\Code\\User\\mcp.json')
    expect(fileFor('vscode', 'win32')).toBe('C:\\Users\\dev\\AppData\\Roaming\\Code\\User\\mcp.json')
  })

  it('writes the entry shape each client expects', () => {
    const entry = (id: (typeof MCP_CLIENT_IDS)[number]) => {
      const registration = mcpClient(id).registration
      return registration.kind === 'file' ? [registration.rootKey, registration.entry(LAUNCH)] : undefined
    }
    expect(entry('vscode')).toEqual(['servers', { type: 'stdio', ...LAUNCH }])
    expect(entry('cursor')).toEqual(['mcpServers', LAUNCH])
    expect(entry('gemini')).toEqual(['mcpServers', LAUNCH])
    expect(entry('windsurf')).toEqual(['mcpServers', LAUNCH])
  })
})
