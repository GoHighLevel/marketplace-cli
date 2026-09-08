import path from 'node:path'

import { Command, Flags } from '@oclif/core'
import open from 'open'

import { sanitizeTerminalText } from '../../../lib/api/response.js'
import { requireRegularFile } from '../../../lib/app/local-workspace.js'
import { externalAuthPlanError, loadExternalAuthSyncContext } from '../../../lib/external-auth/command-context.js'
import { ExternalAuthField } from '../../../lib/external-auth/manifest.js'
import {
  externalAuthTestIdFromState,
  pollExternalAuthTest,
  redactExternalAuthTestOutput,
  validateExternalAuthTestUserData
} from '../../../lib/external-auth/service.js'
import { loadExternalAuthWorkspace } from '../../../lib/external-auth/workspace.js'
import { readJsonFile } from '../../../lib/shared/json-file.js'
import { input, isPromptCancel, password } from '../../../lib/shared/prompts.js'
import { validateHttpUrl } from '../../../lib/shared/validation.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppExternalAuthTest extends Command {
  static description = 'Test the saved Basic or OAuth 2 external-auth flow with sanitized field input'

  static examples = [
    '<%= config.bin %> app external-auth test --input-file ./external-auth-test.json',
    '<%= config.bin %> app external-auth test --no-browser'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    'input-file': Flags.string({ description: 'JSON object containing values for configured external-auth fields' }),
    'no-browser': Flags.boolean({ description: 'Print the OAuth authorization URL instead of opening it' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppExternalAuthTest)
    try {
      const local = await loadExternalAuthWorkspace(flags.directory)
      const inputValue = await this.collectUserData(local.manifest.fields, flags['input-file'])
      const context = await withSpinner(
        'Checking saved external authentication...',
        () => loadExternalAuthSyncContext(local.directory),
        { quiet: this.jsonEnabled() }
      )
      const planError = externalAuthPlanError(context.plan)
      if (planError) throw planError
      if (context.plan.updateRequired) {
        throw new Error('External-auth changes are not saved in the portal. Run `ghl app external-auth push` before testing.')
      }
      const manifest = context.remote.manifest
      if (!manifest.enabled) throw new Error('External authentication is disabled in the portal configuration.')
      const userData = validateExternalAuthTestUserData(manifest.fields, inputValue)
      if (manifest.type === 'basic') {
        const response = await withSpinner(
          'Testing Basic external authentication...',
          () => context.client.testExternalBasicAuth(context.appId, context.versionId, userData),
          { quiet: this.jsonEnabled() }
        )
        return this.renderResult('basic', response, userData)
      }

      const test = await context.client.getExternalAuthTestUrl(context.appId, context.versionId, userData)
      if (/[\u0000-\u001F\u007F-\u009F]/.test(test.url)) {
        throw new Error('OAuth authorization URL must not contain control characters.')
      }
      const urlResult = validateHttpUrl(test.url, 'OAuth authorization URL', { publicOnly: true })
      if (urlResult !== true) throw new Error(urlResult)
      const testId = externalAuthTestIdFromState(test.state)
      if (flags['no-browser']) {
        if (this.jsonEnabled()) this.warn(`Open this OAuth authorization URL: ${test.url}`)
        else this.log(`Open this OAuth authorization URL:\n${test.url}`)
      } else {
        await open(test.url).catch(() => {
          throw new Error(`Could not open a browser. Retry with --no-browser and open the printed URL manually.`)
        })
      }
      const response = await withSpinner(
        'Waiting for OAuth authentication...',
        () => pollExternalAuthTest(context.client, context.appId, testId),
        { quiet: this.jsonEnabled() }
      )
      return this.renderResult('oauth2', response, userData, test.url)
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'External authentication test failed.')
    }
  }

  private async collectUserData(fields: ExternalAuthField[], inputFile?: string): Promise<unknown> {
    if (inputFile) {
      const filePath = path.resolve(inputFile)
      await requireRegularFile(filePath, 'External auth test input')
      const value = await readJsonFile<unknown>(filePath)
      if (value === undefined) throw new Error(`External auth test input "${filePath}" could not be read.`)
      return value
    }
    if (fields.length === 0) return {}
    if (!process.stdin.isTTY || this.jsonEnabled()) {
      throw new Error('External auth test fields require --input-file when running non-interactively or with --json.')
    }
    const value: Record<string, string> = Object.create(null) as Record<string, string>
    for (const field of fields) {
      const label = sanitizeTerminalText(field.label || field.key)
      const promptOptions = {
        message: `${label}${field.required ? ' (required)' : ''}:`,
        validate: (answer: string) => field.required && !answer.trim() ? `${label} is required.` : true
      }
      value[field.key] = field.type === 'password'
        ? await password({ ...promptOptions, mask: '*' })
        : await input(promptOptions)
    }
    return value
  }

  private renderResult(
    type: 'basic' | 'oauth2',
    response: unknown,
    userData: Record<string, string>,
    authorizationUrl?: string
  ): unknown {
    const result = {
      type,
      ...(authorizationUrl ? { authorizationUrl } : {}),
      result: redactExternalAuthTestOutput(response, Object.values(userData))
    }
    if (this.jsonEnabled()) return result
    this.log(`${type === 'oauth2' ? 'OAuth 2' : 'Basic'} external authentication test completed.`)
    this.log(JSON.stringify(result.result, null, 2))
    return
  }
}
