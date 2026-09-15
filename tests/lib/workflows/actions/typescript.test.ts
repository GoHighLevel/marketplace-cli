import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { workflowActionCodeSyntaxError } from '../../../../src/lib/workflows/actions/code.js'
import type { WorkflowActionDefinition } from '../../../../src/lib/workflows/actions/manifest.js'
import {
  compileWorkflowActionTypeScript,
  generateWorkflowActionTypeScriptScaffold
} from '../../../../src/lib/workflows/actions/typescript.js'

const directory = path.resolve('/virtual/workspace')
const filename = path.join(directory, 'src/modules/workflows/actions/code/calculate_score.1.0.ts')

function action(): WorkflowActionDefinition {
  return {
    key: 'calculate_score',
    versions: [
      {
        version: '1.0',
        status: 'draft',
        info: { name: 'Calculate score' },
        inputs: [{ field: 'score', title: 'Score', fieldType: 'numerical', required: true }],
        customVarsJson: { result: 42 }
      }
    ]
  }
}

describe('workflow action TypeScript compiler', () => {
  it('type-checks a default handler and emits executable sandbox JavaScript without writing files', () => {
    const definition = action()
    const version = definition.versions[0]
    const source = generateWorkflowActionTypeScriptScaffold(definition, version)
    const compiled = compileWorkflowActionTypeScript({ directory, filename, source, action: definition, version })

    expect(compiled.errors).toEqual([])
    expect(compiled.code).not.toMatch(/\b(?:import|export|interface|type)\b/)
    expect(compiled.code).toContain('inputData')
    expect(compiled.code).toContain('customRequest')
    expect(workflowActionCodeSyntaxError(compiled.code, 'calculate_score.1.0.js')).toBeUndefined()
  })

  it('accepts an idiomatic default function declaration', () => {
    const definition = action()
    const version = definition.versions[0]
    const source = `
import type { GhlActionCalculateScoreV1_0Handler } from '../../../../../ghl-action-calculate_score'

const handler: GhlActionCalculateScoreV1_0Handler = async ({ inputData }) => ({
  result: Number(inputData.data.score)
})

export default async function action(context: Parameters<GhlActionCalculateScoreV1_0Handler>[0]) {
  return handler(context)
}
`
    const compiled = compileWorkflowActionTypeScript({ directory, filename, source, action: definition, version })

    expect(compiled.errors).toEqual([])
    expect(compiled.code).not.toContain('export default')
    expect(compiled.code).toMatch(/async function action/)
    expect(workflowActionCodeSyntaxError(compiled.code, 'calculate_score.1.0.js')).toBeUndefined()
  })

  it('reports field mistakes and unavailable platform APIs before push', () => {
    const definition = action()
    const version = definition.versions[0]
    const source = `
import type { GhlActionCalculateScoreV1_0Handler } from '../../../../../ghl-action-calculate_score'

const action: GhlActionCalculateScoreV1_0Handler = async ({ inputData }) => {
  await fetch('https://example.com')
  return { result: inputData.data.missing }
}

export default action
`
    const compiled = compileWorkflowActionTypeScript({ directory, filename, source, action: definition, version })

    expect(compiled.code).toBe('')
    expect(compiled.errors.join('\n')).toMatch(/Cannot find name 'fetch'/)
    expect(compiled.errors.join('\n')).toMatch(/Property 'missing' does not exist/)
  })

  it('rejects runtime imports and requires the default export to match the generated handler', () => {
    const definition = action()
    const version = definition.versions[0]
    const runtimeImport = compileWorkflowActionTypeScript({
      directory,
      filename,
      source: "import path from 'node:path'\nexport default path",
      action: definition,
      version
    })
    const invalidExport = compileWorkflowActionTypeScript({
      directory,
      filename,
      source: 'export default 42',
      action: definition,
      version
    })
    const additionalRuntimeExport = compileWorkflowActionTypeScript({
      directory,
      filename,
      source: 'export const helper = 42\nexport default async () => ({ result: helper })',
      action: definition,
      version
    })

    expect(runtimeImport.errors.join('\n')).toMatch(/type-only imports/i)
    expect(invalidExport.errors.join('\n')).toMatch(/default export.*handler/i)
    expect(additionalRuntimeExport.errors.join('\n')).toMatch(/runtime exports/i)
  })

  it('types every supported injected helper', () => {
    const definition = action()
    const version = definition.versions[0]
    const source = `
import type { GhlActionCalculateScoreV1_0Handler } from '../../../../../ghl-action-calculate_score'

const action: GhlActionCalculateScoreV1_0Handler = async context => {
  const response = await context.customRequest.post<{ total: number }>('https://example.com', {
    data: { score: context.inputData.data.score },
    headers: { 'x-attempt': 1 },
    params: { mode: 'safe' }
  })
  const encoded = context._base64.encode(String(response.data.total))
  const id = context._uuid.v4()
  const rows = context._csv.parse('score\\n42')
  const total = context._.sum([response.data.total])
  const day = context.moment('2026-09-15').format('YYYY-MM-DD')
  context.console.log(encoded, id, rows, day)
  return { result: total }
}

export default action
`
    const compiled = compileWorkflowActionTypeScript({ directory, filename, source, action: definition, version })

    expect(compiled.errors).toEqual([])
  })
})
