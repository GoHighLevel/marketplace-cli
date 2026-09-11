import { describe, expect, it } from 'vitest'

import { renderSecretEntries, scopeSecretEntries } from '../../../src/lib/secrets/display.js'
import { type SecretEntry } from '../../../src/lib/secrets/ledger.js'

const entries: SecretEntry[] = [
  {
    kind: 'sandbox-password',
    label: 'Test Agency',
    reference: 'company1',
    value: 'MySandbox@Pass1',
    createdAt: '2026-08-10T09:00:00.000Z'
  },
  {
    kind: 'client-secret',
    label: 'production',
    reference: 'app1-aaa',
    appId: 'app1',
    value: 'secret-value-1234',
    createdAt: '2026-08-10T09:30:00.000Z'
  }
]

describe('renderSecretEntries', () => {
  it('groups by kind with human field labels, client keys first', () => {
    const lines = renderSecretEntries(entries, true)
    expect(lines).toEqual([
      'Client keys:',
      '  Name:          production',
      '  Client ID:     app1-aaa',
      '  Client secret: secret-value-1234',
      '  Created:       2026-08-10 09:30:00',
      '',
      'Sandbox passwords:',
      '  Account:       Test Agency',
      '  Company ID:    company1',
      '  Password:      MySandbox@Pass1',
      '  Created:       2026-08-10 09:00:00'
    ])
  })

  it('masks values when reveal is off', () => {
    const lines = renderSecretEntries(entries, false)
    expect(lines).toContain('  Client secret: ****1234')
    expect(lines).toContain('  Password:      ****ass1')
    expect(lines.join('\n')).not.toContain('secret-value-1234')
  })

  it('renders nothing for an empty list', () => {
    expect(renderSecretEntries([], true)).toEqual([])
  })
})

describe('scopeSecretEntries', () => {
  it('keeps app and account-level secrets in separate scopes', () => {
    const scoped = scopeSecretEntries(entries, 'app1')
    expect(scoped.appEntries.map(entry => entry.kind)).toEqual(['client-secret'])
    expect(scoped.accountEntries.map(entry => entry.kind)).toEqual(['sandbox-password'])
    expect(scoped.visible.map(entry => entry.kind)).toEqual(['client-secret'])
    expect(scopeSecretEntries(entries, 'app2').visible).toEqual([])
    expect(scopeSecretEntries(entries, 'app1', true).visible.map(entry => entry.kind)).toEqual([
      'client-secret',
      'sandbox-password'
    ])
    expect(scopeSecretEntries(entries).visible.map(entry => entry.kind)).toEqual(['sandbox-password'])
  })
})
