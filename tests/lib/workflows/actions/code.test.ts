import { describe, expect, it } from 'vitest'

import {
  workflowActionCodeFilename,
  workflowActionCodeReference,
  workflowActionCodeSyntaxError
} from '../../../../src/lib/workflows/actions/code.js'

describe('workflow action code', () => {
  it('creates deterministic version-aware filenames and references', () => {
    expect(workflowActionCodeFilename('calculate_score', '1.2')).toBe('calculate_score.1.2.js')
    expect(workflowActionCodeReference('calculate_score', '1.2')).toBe('code/calculate_score.1.2.js')
  })

  it('validates the async function-body syntax accepted by the portal', () => {
    expect(
      workflowActionCodeSyntaxError(
        'const value = await Promise.resolve(42)\nreturn { value }',
        'code/calculate_score.1.0.js'
      )
    ).toBeUndefined()
    expect(workflowActionCodeSyntaxError('const value = ;', 'code/calculate_score.1.0.js')).toMatch(
      /calculate_score\.1\.0\.js:1.*unexpected token/i
    )
  })

  it('compiles source without executing it', () => {
    const marker = '__ghlWorkflowActionCodeWasExecuted'
    delete (globalThis as Record<string, unknown>)[marker]

    expect(
      workflowActionCodeSyntaxError(`globalThis.${marker} = true\nreturn {}`, 'code/safe_action.1.0.js')
    ).toBeUndefined()
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined()
  })
})
