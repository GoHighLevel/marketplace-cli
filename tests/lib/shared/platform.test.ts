import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { platformPath } from '../../../src/lib/shared/platform.js'

describe('platformPath', () => {
  it('returns Windows path rules for win32 and POSIX rules everywhere else', () => {
    expect(platformPath('win32')).toBe(path.win32)
    expect(platformPath('darwin')).toBe(path.posix)
    expect(platformPath('linux')).toBe(path.posix)
  })
})
