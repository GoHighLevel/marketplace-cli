import { describe, expect, it } from 'vitest'

import { buildCreateAppBody, validateAppName } from '../../../src/lib/app/create.js'

describe('buildCreateAppBody', () => {
  it('maps agency target to Company-only distribution regardless of installer', () => {
    const body = buildCreateAppBody({ name: 'A', type: 'public', target: 'agency', listing: 'white-label' })
    expect(body.userTypes).toEqual(['Company'])
  })

  it('maps sub-account target open to everyone to Location only', () => {
    const body = buildCreateAppBody({
      name: 'A',
      type: 'public',
      target: 'sub-account',
      installer: 'everyone',
      listing: 'white-label'
    })
    expect(body.userTypes).toEqual(['Location'])
  })

  it('adds Company when only agencies can install a sub-account app', () => {
    const body = buildCreateAppBody({
      name: 'A',
      type: 'public',
      target: 'sub-account',
      installer: 'agency-only',
      listing: 'white-label'
    })
    expect(body.userTypes).toEqual(['Location', 'Company'])
  })

  it('maps type, listing, and always enables agency bulk install', () => {
    const body = buildCreateAppBody({
      name: '  Trimmed  ',
      type: 'private',
      target: 'sub-account',
      installer: 'everyone',
      listing: 'standard'
    })
    expect(body).toEqual({
      name: 'Trimmed',
      private: true,
      userTypes: ['Location'],
      isWhiteLabelFriendly: false,
      isAgencyBulkInstallEnabled: true
    })
  })
})

describe('validateAppName', () => {
  it('rejects empty and too-long names, accepts valid ones', () => {
    expect(validateAppName('')).toMatch(/required/)
    expect(validateAppName('x'.repeat(51))).toMatch(/50/)
    expect(validateAppName('My App')).toBe(true)
  })
})
