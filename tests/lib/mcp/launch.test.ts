import { describe, expect, it } from 'vitest'

import {
  buildLaunchCommand,
  DEFAULT_NPM_REGISTRY,
  formatLaunchCommand,
  isEphemeralInstall,
  validateCliVersion,
  validateRegistry
} from '../../../src/lib/mcp/launch.js'

const BASE = {
  packageName: '@gohighlevel/marketplace-cli',
  binName: 'ghl',
  version: '1.2.3',
  registry: DEFAULT_NPM_REGISTRY
}

describe('buildLaunchCommand', () => {
  it('launches a local install by absolute Node and script paths', () => {
    expect(
      buildLaunchCommand({
        ...BASE,
        root: '/Users/dev/.nvm/versions/node/v20/lib/node_modules/@gohighlevel/marketplace-cli',
        execPath: '/Users/dev/.nvm/versions/node/v20/bin/node',
        platform: 'darwin',
        standalone: false
      })
    ).toEqual({
      command: '/Users/dev/.nvm/versions/node/v20/bin/node',
      args: [
        '/Users/dev/.nvm/versions/node/v20/lib/node_modules/@gohighlevel/marketplace-cli/bin/run.js',
        'mcp',
        'start'
      ]
    })
  })

  it('builds Windows paths for a local Windows install', () => {
    expect(
      buildLaunchCommand({
        ...BASE,
        root: 'C:\\npm\\node_modules\\@gohighlevel\\marketplace-cli',
        execPath: 'C:\\Program Files\\nodejs\\node.exe',
        platform: 'win32',
        standalone: false
      }).args[0]
    ).toBe('C:\\npm\\node_modules\\@gohighlevel\\marketplace-cli\\bin\\run.js')
  })

  it('pins standalone launches to a package version and registry, and wraps npx for Windows clients', () => {
    const options = { ...BASE, root: '/tmp/x', execPath: '/usr/bin/node', standalone: true }
    const npxArgs = [
      '-y',
      '--registry=https://registry.npmjs.org/',
      '--package',
      '@gohighlevel/marketplace-cli@1.2.3',
      'ghl',
      'mcp',
      'start'
    ]

    expect(buildLaunchCommand({ ...options, platform: 'linux' })).toEqual({ command: 'npx', args: npxArgs })
    expect(buildLaunchCommand({ ...options, platform: 'win32' })).toEqual({
      command: 'cmd',
      args: ['/c', 'npx', ...npxArgs]
    })
  })

  it('quotes only the parts that contain whitespace for display', () => {
    expect(formatLaunchCommand({ command: 'C:\\Program Files\\node.exe', args: ['run.js', 'mcp'] })).toBe(
      '"C:\\\\Program Files\\\\node.exe" run.js mcp'
    )
  })
})

describe('install detection and version input', () => {
  it.each([
    ['/Users/dev/.npm/_npx/0a1b2c/node_modules/@gohighlevel/marketplace-cli', true],
    ['C:\\Users\\dev\\AppData\\Local\\npm-cache\\_npx\\0a1b\\node_modules\\x', true],
    ['/Users/dev/Library/Caches/pnpm/dlx/abc/node_modules/x', true],
    ['/tmp/bunx-501-@gohighlevel/marketplace-cli@1.0.0/node_modules/x', true],
    ['/usr/local/lib/node_modules/@gohighlevel/marketplace-cli', false]
  ])('isEphemeralInstall(%s) is %s', (root, expected) => {
    expect(isEphemeralInstall(root)).toBe(expected)
  })

  it('accepts exact versions and latest but nothing that could change the command', () => {
    expect(validateCliVersion(' 1.2.3 ')).toBe('1.2.3')
    expect(validateCliVersion('2.0.0-beta.1')).toBe('2.0.0-beta.1')
    expect(validateCliVersion('latest')).toBe('latest')
    for (const value of ['^1.2.0', '1.2', '1.2.3 && rm -rf /', 'next', '']) {
      expect(() => validateCliVersion(value)).toThrow(/--cli-version/)
    }
  })

  it('accepts only https registries without credentials', () => {
    expect(validateRegistry('https://npm.example.com/repo')).toBe('https://npm.example.com/repo')
    for (const value of ['http://npm.example.com/', 'https://user:token@npm.example.com/', 'not a url']) {
      expect(() => validateRegistry(value)).toThrow(/--registry must be an https URL/)
    }
  })
})
