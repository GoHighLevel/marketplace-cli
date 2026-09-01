import { describe, expect, it } from 'vitest'

import {
  assertWorkflowActionTestSucceeded,
  prepareWorkflowActionTestRequest
} from '../../../../src/lib/workflows/actions/test-execution.js'

describe('workflow action execution tests', () => {
  it('hydrates saved header objects and sends the UI test-endpoint shape', () => {
    const request = prepareWorkflowActionTestRequest({
      appId: 'app-1',
      inputData: { email: 'developer@example.com' },
      locationId: 'location-1',
      version: {
        version: '1.0',
        status: 'draft',
        info: { name: 'Send message' },
        executionConfig: {
          type: 'API',
          url: 'https://example.com/action',
          method: 'POST',
          headers: { Authorization: '${remote}', Accept: 'application/json' },
          pauseExecution: true
        }
      },
      remoteVersion: {
        version: '1.0',
        status: 'draft',
        info: { name: 'Send message' },
        executionConfig: {
          type: 'API',
          url: 'https://example.com/action',
          method: 'POST',
          headers: { Authorization: 'Bearer remote-token', Accept: 'application/json' },
          pauseExecution: true
        }
      }
    })

    expect(request).toEqual({
      appId: 'app-1',
      locationId: 'location-1',
      inputData: { email: 'developer@example.com' },
      executionConfig: {
        type: 'API',
        url: 'https://example.com/action',
        method: 'POST',
        headers: [
          { label: 'Authorization', key: 'Bearer remote-token' },
          { label: 'Accept', key: 'application/json' }
        ]
      }
    })
  })

  it('always supplies a header array for code tests and removes pauseExecution', () => {
    const request = prepareWorkflowActionTestRequest({
      appId: 'app-1',
      inputData: {},
      version: {
        version: '1.0',
        status: 'draft',
        info: { name: 'Run code' },
        executionConfig: { type: 'CODE', code: 'return {}', pauseExecution: false }
      }
    })

    expect(request.executionConfig).toEqual({ type: 'CODE', code: 'return {}', headers: [] })
    expect(request).not.toHaveProperty('locationId')
  })

  it('injects configured branch metadata into action test input', () => {
    const request = prepareWorkflowActionTestRequest({
      appId: 'app-1',
      inputData: { score: 95 },
      version: {
        version: '1.0',
        status: 'draft',
        info: { name: 'Route contact' },
        executionConfig: { type: 'CODE', code: 'return {}' },
        branchesConfig: {
          predefinedBranches: {
            branches: [{
              id: 'branch-1',
              branchName: 'Ready',
              conditionType: 'user-defined',
              fields: { outcome: 'ready' },
              meta: { category: 'qualified' }
            }]
          }
        }
      }
    })

    expect(request.inputData).toEqual({
      score: 95,
      branches: [{
        id: 'branch-1',
        name: 'Ready',
        fields: { outcome: 'ready' },
        meta: { category: 'qualified' }
      }]
    })
  })

  it('does not allow test input to override configured branches', () => {
    expect(() => prepareWorkflowActionTestRequest({
      appId: 'app-1',
      inputData: { branches: [] },
      version: {
        version: '1.0',
        status: 'draft',
        info: { name: 'Route contact' },
        executionConfig: { type: 'CODE', code: 'return {}' },
        branchesConfig: {
          predefinedBranches: {
            branches: [{
              id: 'branch-1',
              branchName: 'Ready',
              conditionType: 'user-defined',
              fields: { outcome: 'ready' }
            }]
          }
        }
      }
    })).toThrow(/reserved field "branches"/i)
  })

  it('rejects failed tests and primitive code output', () => {
    expect(() => assertWorkflowActionTestSucceeded(
      { hasError: true, errorMessage: { status: 500, error: 'failed' } },
      'API'
    )).toThrow(/workflow action test failed.*500.*failed/i)

    expect(() => assertWorkflowActionTestSucceeded(
      { hasError: false, output: 'primitive' },
      'CODE'
    )).toThrow(/code output must be a JavaScript object or array/i)
  })
})
