import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

import { PromptCancelledError, isPromptCancel, withEscapeCancel } from '../../../src/lib/shared/prompts.js'

function fakeStdin(): NodeJS.ReadableStream {
  return new EventEmitter() as unknown as NodeJS.ReadableStream
}

/* A stand-in prompt that resolves on demand and rejects when its signal
   aborts — the same contract @inquirer/core prompts follow. */
function promptStub(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')))
    setTimeout(() => resolve('answer'), 20)
  })
}

describe('withEscapeCancel', () => {
  it('cancels the prompt when escape is pressed', async () => {
    const stdin = fakeStdin()
    const promise = withEscapeCancel(({ signal }) => promptStub(signal), stdin)
    stdin.emit('keypress', undefined, { name: 'escape' })
    await expect(promise).rejects.toBeInstanceOf(PromptCancelledError)
  })

  it('ignores other keys and passes the answer through', async () => {
    const stdin = fakeStdin()
    const promise = withEscapeCancel(({ signal }) => promptStub(signal), stdin)
    stdin.emit('keypress', 'a', { name: 'a' })
    await expect(promise).resolves.toBe('answer')
    expect(stdin.listenerCount('keypress')).toBe(0)
  })

  it('treats Ctrl+C (ExitPromptError) as a cancel', async () => {
    const exit = new Error('User force closed the prompt')
    exit.name = 'ExitPromptError'
    await expect(withEscapeCancel(() => Promise.reject(exit), fakeStdin())).rejects.toBeInstanceOf(PromptCancelledError)
  })

  it('re-throws real errors and removes the listener', async () => {
    const stdin = fakeStdin()
    const failure = new Error('network down')
    await expect(withEscapeCancel(() => Promise.reject(failure), stdin)).rejects.toBe(failure)
    expect(stdin.listenerCount('keypress')).toBe(0)
  })

  it('identifies cancellations via isPromptCancel', () => {
    expect(isPromptCancel(new PromptCancelledError())).toBe(true)
    expect(isPromptCancel(new Error('other'))).toBe(false)
    expect(new PromptCancelledError().message).toMatch(/nothing was changed/i)
  })
})
