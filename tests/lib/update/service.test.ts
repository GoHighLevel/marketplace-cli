import { describe, expect, it } from 'vitest'

import { buildUpdateInvocation, detectPackageManager, formatUpdateInvocation } from '../../../src/lib/update/service.js'

describe('CLI self-update', () => {
  it.each([
    [['/Users/test/.volta/tools/image/packages/marketplace-cli/bin/ghl'], undefined, 'volta'],
    [['/Users/test/Library/pnpm/global/5/node_modules/marketplace-cli/bin/ghl'], undefined, 'pnpm'],
    [['/Users/test/.bun/install/global/node_modules/marketplace-cli/bin/ghl'], undefined, 'bun'],
    [['/Users/test/.yarn/bin/ghl'], undefined, 'yarn'],
    [
      ['/usr/local/bin/ghl', '/Users/test/.config/yarn/global/node_modules/@gohighlevel/marketplace-cli'],
      undefined,
      'yarn'
    ],
    [['/usr/local/bin/ghl', 'C:\\Users\\test\\AppData\\Local\\pnpm\\global\\5\\node_modules\\x'], undefined, 'pnpm'],
    [['/usr/local/bin/ghl'], 'yarn/1.22.22 npm/? node/v20', 'yarn'],
    [['/usr/local/bin/ghl'], 'yarn/4.1.0 npm/? node/v20', 'npm'],
    [['/usr/local/bin/ghl'], 'npm/10.8.2 node/v20', 'npm'],
    [['/usr/local/bin/ghl'], undefined, 'npm'],
    [[undefined], undefined, 'npm']
  ])('detects the installer from %j and %s', (installPaths, userAgent, expected) => {
    expect(detectPackageManager(installPaths, userAgent)).toBe(expected)
  })

  it.each([
    ['npm', 'npm install --global @gohighlevel/marketplace-cli@latest'],
    ['pnpm', 'pnpm add --global @gohighlevel/marketplace-cli@latest'],
    ['yarn', 'yarn global add @gohighlevel/marketplace-cli@latest'],
    ['bun', 'bun add --global @gohighlevel/marketplace-cli@latest'],
    ['volta', 'volta install @gohighlevel/marketplace-cli@latest']
  ] as const)('builds the %s global update command', (packageManager, expected) => {
    const invocation = buildUpdateInvocation(packageManager, 'darwin')
    expect(formatUpdateInvocation(invocation)).toBe(expected)
    expect(invocation.shell).toBe(false)
  })

  it('runs Windows package-manager shims through the shell with fixed arguments', () => {
    expect(buildUpdateInvocation('npm', 'win32')).toEqual({
      command: 'npm',
      args: ['install', '--global', '@gohighlevel/marketplace-cli@latest'],
      shell: true
    })
  })
})
