import { Script } from 'node:vm'

import { workflowActionKeyValidationErrors } from './key.js'

export const WORKFLOW_ACTION_CODE_DIRECTORY_NAME = 'code'
export const WORKFLOW_ACTION_CODE_MAX_BYTES = 1024 * 1024

const ACTION_VERSION = /^\d+\.\d+$/

export function workflowActionCodeFilename(key: string, version: string): string {
  const keyErrors = workflowActionKeyValidationErrors(key)
  if (keyErrors.length > 0) throw new Error(`Workflow action key "${key}" ${keyErrors.join(' and ')}.`)
  if (!ACTION_VERSION.test(version)) throw new Error(`Workflow action version "${version}" must use major.minor format.`)
  return `${key}.${version}.js`
}

export function workflowActionCodeReference(key: string, version: string): string {
  return `${WORKFLOW_ACTION_CODE_DIRECTORY_NAME}/${workflowActionCodeFilename(key, version)}`
}

export function workflowActionCodeSyntaxError(code: string, filename: string): string | undefined {
  try {
    /*
     * The portal executes marketplace source as an async function body. Compiling the
     * same wrapper validates top-level await and return without executing user code.
     */
    new Script(`(async () => {\n${code}\n})`, { filename, lineOffset: -1 })
    return undefined
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    const location = error.stack?.split('\n', 1)[0]
    return `${location?.startsWith(`${filename}:`) ? location : filename}: ${error.message}`
  }
}
