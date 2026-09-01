import { afterEach, describe, expect, it, vi } from 'vitest'

import { withSpinner } from '../../../src/lib/shared/spinner.js'

afterEach(() => {
  vi.restoreAllMocks()
})

/* stderr is not a TTY under vitest, so these exercise the pass-through path. */
describe('withSpinner', () => {
  it('returns the task result', async () => {
    await expect(withSpinner('working', async () => 42)).resolves.toBe(42)
  })

  it('propagates task errors', async () => {
    await expect(
      withSpinner('working', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
  })

  it('is a pass-through in quiet mode', async () => {
    await expect(withSpinner('working', async () => 'ok', { quiet: true })).resolves.toBe('ok')
  })

  it('renders sanitized progress and clears it on an interactive stderr', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
      await expect(withSpinner('\u001B[31mworking', async () => 'ok')).resolves.toBe('ok')
      const output = write.mock.calls.map(call => String(call[0])).join('')
      expect(output).toContain('working')
      expect(output).not.toContain('\u001B[31m')
      expect(output).toContain('\u001B[2K')
    } finally {
      if (descriptor) Object.defineProperty(process.stderr, 'isTTY', descriptor)
      else delete (process.stderr as { isTTY?: boolean }).isTTY
    }
  })
})
