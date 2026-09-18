import { describe, expect, it } from 'vitest'

import { buildUpdateInvocation, detectPackageManager, formatUpdateInvocation } from '../../../src/lib/update/service.js'

describe('CLI self-update', () => {
  it.each([
    ['/Users/test/.volta/tools/image/packages/marketplace-cli/bin/ghl', undefined, 'volta'],
    ['/Users/test/Library/pnpm/global/5/node_modules/marketplace-cli/bin/ghl', undefined, 'pnpm'],
    ['/Users/test/.bun/install/global/node_modules/marketplace-cli/bin/ghl', undefined, 'bun'],
    ['/usr/local/bin/ghl', 'yarn/1.22.22 npm/? node/v20', 'yarn'],
    ['/usr/local/bin/ghl', 'npm/10.8.2 node/v20', 'npm'],
    ['/usr/local/bin/ghl', undefined, 'npm']
  ])('detects the installer from %s and %s', (executablePath, userAgent, expected) => {
    expect(detectPackageManager(executablePath, userAgent)).toBe(expected)
  })

  it.each([
    ['npm', 'npm install --global @gohighlevel/marketplace-cli@latest'],
    ['pnpm', 'pnpm add --global @gohighlevel/marketplace-cli@latest'],
    ['yarn', 'yarn global add @gohighlevel/marketplace-cli@latest'],
    ['bun', 'bun add --global @gohighlevel/marketplace-cli@latest'],
    ['volta', 'volta install @gohighlevel/marketplace-cli@latest']
  ] as const)('builds the %s global update command', (packageManager, expected) => {
    expect(formatUpdateInvocation(buildUpdateInvocation(packageManager, 'darwin'))).toBe(expected)
  })

  it('uses executable shims on Windows without invoking a shell', () => {
    expect(buildUpdateInvocation('npm', 'win32')).toEqual({
      command: 'npm.cmd',
      args: ['install', '--global', '@gohighlevel/marketplace-cli@latest']
    })
  })
})
