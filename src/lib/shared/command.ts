import { Command, Errors } from '@oclif/core'

import { errorMessage } from './errors.js'
import { isPromptCancel } from './prompts.js'

/* Base class for every CLI command. `run` owns the shared failure handling so
   commands only implement `execute`: a cancelled prompt exits cleanly, oclif
   errors (including explicit exits) pass through, and anything else becomes a
   command error with the thrown message. */
export abstract class GhlCommand extends Command {
  protected readonly failureMessage = 'Command failed.'

  async run(): Promise<unknown> {
    try {
      return await this.execute()
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return undefined
      }
      if (error instanceof Errors.CLIError) throw error
      this.error(errorMessage(error, this.failureMessage))
    }
  }

  protected abstract execute(): Promise<unknown>
}
