import {
  checkbox as inquirerCheckbox,
  confirm as inquirerConfirm,
  input as inquirerInput,
  password as inquirerPassword,
  select as inquirerSelect
} from '@inquirer/prompts'

import { type CheckboxSearchConfig, checkboxSearch as rawCheckboxSearch } from './checkbox-search.js'

export class PromptCancelledError extends Error {
  constructor() {
    super('Cancelled — nothing was changed.')
    this.name = 'PromptCancelledError'
  }
}

export function isPromptCancel(error: unknown): error is PromptCancelledError {
  return error instanceof PromptCancelledError
}

interface KeypressEvent {
  name?: string
}

/* Runs a prompt with Esc-to-cancel: keypress events flow on stdin while a
   prompt is active, so a parallel listener aborts the prompt's signal. Both
   Esc and Ctrl+C surface as PromptCancelledError before any API call. */
export async function withEscapeCancel<T>(
  run: (context: { signal: AbortSignal }) => Promise<T>,
  stdin: NodeJS.ReadableStream = process.stdin
): Promise<T> {
  const controller = new AbortController()
  const onKeypress = (_char: string | undefined, key: KeypressEvent | undefined) => {
    if (key?.name === 'escape') controller.abort()
  }
  stdin.on('keypress', onKeypress)
  try {
    return await run({ signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new PromptCancelledError()
    if (error instanceof Error && error.name === 'ExitPromptError') throw new PromptCancelledError()
    throw error
  } finally {
    stdin.removeListener('keypress', onKeypress)
  }
}

export function input(config: Parameters<typeof inquirerInput>[0]): Promise<string> {
  return withEscapeCancel(context => inquirerInput(config, context))
}

export function password(config: Parameters<typeof inquirerPassword>[0]): Promise<string> {
  return withEscapeCancel(context => inquirerPassword(config, context))
}

export function confirm(config: Parameters<typeof inquirerConfirm>[0]): Promise<boolean> {
  return withEscapeCancel(context => inquirerConfirm(config, context))
}

export function select<Value>(config: Parameters<typeof inquirerSelect<Value>>[0]): Promise<Value> {
  return withEscapeCancel(context => inquirerSelect<Value>(config, context))
}

export function checkbox<Value>(config: Parameters<typeof inquirerCheckbox<Value>>[0]): Promise<Value[]> {
  return withEscapeCancel(context => inquirerCheckbox<Value>(config, context))
}

export function checkboxSearch<Value>(config: CheckboxSearchConfig<Value>): Promise<Value[]> {
  return withEscapeCancel(context => rawCheckboxSearch(config, context))
}
