import { Script } from 'node:vm'

import { workflowActionKeyValidationErrors } from './key.js'

export const WORKFLOW_ACTION_CODE_DIRECTORY_NAME = 'code'
export const WORKFLOW_ACTION_CODE_MAX_BYTES = 1024 * 1024

const ACTION_VERSION = /^\d+\.\d+$/

export type WorkflowActionSourceLanguage = 'javascript' | 'typescript'

function sourceExtension(language: WorkflowActionSourceLanguage): string {
  return language === 'typescript' ? 'ts' : 'js'
}

export function workflowActionCodeFilename(
  key: string,
  version: string,
  language: WorkflowActionSourceLanguage = 'javascript'
): string {
  const keyErrors = workflowActionKeyValidationErrors(key)
  if (keyErrors.length > 0) throw new Error(`Workflow action key "${key}" ${keyErrors.join(' and ')}.`)
  if (!ACTION_VERSION.test(version))
    throw new Error(`Workflow action version "${version}" must use major.minor format.`)
  return `${key}.${version}.${sourceExtension(language)}`
}

export function workflowActionCodeReference(
  key: string,
  version: string,
  language: WorkflowActionSourceLanguage = 'javascript'
): string {
  return `${WORKFLOW_ACTION_CODE_DIRECTORY_NAME}/${workflowActionCodeFilename(key, version, language)}`
}

export function workflowActionSourceLanguage(reference: string): WorkflowActionSourceLanguage | undefined {
  if (reference.endsWith('.ts')) return 'typescript'
  if (reference.endsWith('.js')) return 'javascript'
  return undefined
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
