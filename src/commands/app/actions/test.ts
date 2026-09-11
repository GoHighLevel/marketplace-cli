import { Args, Flags } from '@oclif/core'
import path from 'node:path'

import { GhlCommand } from '../../../lib/shared/command.js'
import { isRecord } from '../../../lib/api/response.js'
import { readJsonFile } from '../../../lib/shared/json-file.js'
import { loadWorkflowActionsRemoteContext } from '../../../lib/workflows/actions/command-context.js'
import {
  assertWorkflowActionTestSucceeded,
  prepareWorkflowActionTestRequest
} from '../../../lib/workflows/actions/test-execution.js'
import { fetchWorkflowActionsSnapshot } from '../../../lib/workflows/actions/service.js'
import { loadWorkflowActionsWorkspace } from '../../../lib/workflows/actions/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

async function testInput(flags: { input?: string; 'input-file'?: string }): Promise<Record<string, unknown>> {
  if (flags.input !== undefined && flags['input-file'] !== undefined) {
    throw new Error('Use either --input or --input-file, not both.')
  }
  let value: unknown = {}
  if (flags.input !== undefined) {
    try {
      value = JSON.parse(flags.input)
    } catch (error) {
      throw new Error(`--input contains invalid JSON: ${(error as Error).message}`)
    }
  } else if (flags['input-file'] !== undefined) {
    const file = path.resolve(flags['input-file'])
    value = await readJsonFile<unknown>(file)
    if (value === undefined) throw new Error(`Input JSON file "${file}" does not exist.`)
  }
  if (!isRecord(value)) throw new Error('Workflow action test input must be a JSON object.')
  return value
}

export default class AppActionsTest extends GhlCommand {
  static description = 'Execute a local workflow action configuration through the portal test runner'

  static examples = [
    '<%= config.bin %> app actions test send_message --input \'{"email":"developer@example.com"}\'',
    '<%= config.bin %> app actions test send_message --input-file ./test-input.json --location locationId',
    '<%= config.bin %> app actions test send_message --version 1.1 --json'
  ]

  static enableJsonFlag = true

  static args = {
    action: Args.string({ required: true, description: 'Action key or template id to test' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    version: Flags.string({ description: 'Action version (defaults to its draft or newest local version)' }),
    input: Flags.string({ description: 'Test input as a JSON object' }),
    'input-file': Flags.string({ description: 'Path to a JSON object containing test input' }),
    location: Flags.string({ description: 'Installed location id for external-auth values and location context' })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppActionsTest)
    const workspace = await loadWorkflowActionsWorkspace(flags.directory)
    const inputData = await testInput(flags)
    const action = workspace.manifest.actions.find(item => item.key === args.action || item.templateId === args.action)
    if (!action) throw new Error(`Workflow action "${args.action}" was not found in this workspace.`)
    const version = flags.version
      ? action.versions.find(item => item.version === flags.version)
      : (action.versions.find(item => item.status === 'draft') ?? action.versions[0])
    if (!version) {
      throw new Error(
        `Workflow action "${action.key}"${flags.version ? ` version ${flags.version}` : ''} was not found.`
      )
    }

    const context = await loadWorkflowActionsRemoteContext({
      appId: workspace.manifest.appId,
      directory: workspace.directory,
      requireWorkspaceMatch: true
    })
    const snapshot = await withSpinner(
      'Preparing workflow action test...',
      () => fetchWorkflowActionsSnapshot(context.client, context.appId),
      { quiet: this.jsonEnabled() }
    )
    const remoteVersion = snapshot.runtime.actions
      .find(item => item.key === action.key)
      ?.versions.find(item => item.version === version.version)
    const request = prepareWorkflowActionTestRequest({
      appId: context.appId,
      inputData,
      locationId: flags.location,
      version,
      remoteVersion
    })
    const response = await withSpinner(
      'Running workflow action test...',
      () => context.client.testWorkflowAction(context.appId, request),
      { quiet: this.jsonEnabled() }
    )
    assertWorkflowActionTestSucceeded(response, request.executionConfig.type)
    const result = {
      appId: context.appId,
      key: action.key,
      version: version.version,
      type: request.executionConfig.type,
      output: response.output,
      consoleLogs: response.consoleLogs ?? []
    }
    if (this.jsonEnabled()) return result
    this.log(`Workflow action test passed for "${action.key}" version ${version.version}.`)
    this.log(JSON.stringify(response.output, null, 2))
    if (result.consoleLogs.length > 0) {
      this.log(`Console output:\n${result.consoleLogs.join('\n')}`)
    }
  }
}
