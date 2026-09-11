import { Config, Errors } from '@oclif/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { GhlCommand } from '../../../src/lib/shared/command.js'
import { PromptCancelledError } from '../../../src/lib/shared/prompts.js'

let config: Config

function commandThrowing(value: unknown): GhlCommand {
  class Throwing extends GhlCommand {
    protected async execute(): Promise<unknown> {
      throw value
    }
  }
  return new Throwing([], config)
}

beforeAll(async () => {
  config = await Config.load({ root: process.cwd() })
})

describe('GhlCommand', () => {
  it('returns the execute result', async () => {
    class Succeeding extends GhlCommand {
      protected async execute(): Promise<unknown> {
        return { ok: true }
      }
    }
    await expect(new Succeeding([], config).run()).resolves.toEqual({ ok: true })
  })

  it('logs a cancelled prompt and exits cleanly', async () => {
    const command = commandThrowing(new PromptCancelledError())
    const log = vi.spyOn(command, 'log').mockImplementation(() => undefined)

    await expect(command.run()).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith('Cancelled — nothing was changed.')
  })

  it('turns a thrown Error into a command error with the same message', async () => {
    const command = commandThrowing(new Error('workspace is missing'))
    await expect(command.run()).rejects.toMatchObject({ message: 'workspace is missing', oclif: { exit: 2 } })
  })

  it('uses the fallback message for non-Error values', async () => {
    await expect(commandThrowing('boom').run()).rejects.toMatchObject({ message: 'Command failed.' })
  })

  it('passes oclif errors through unchanged', async () => {
    const original = new Errors.CLIError('custom exit', { exit: 7 })
    await expect(commandThrowing(original).run()).rejects.toBe(original)
  })
})
