import { describe, expect, it } from 'vitest'

import {
  activeVersionCount,
  baseVersionFromList,
  bumpOptions,
  bumpVersion,
  minimumBumpFromAnalysis,
  pendingVersions,
  requireDraftable,
  requireDeprecatable,
  validateNewVersion
} from '../../../src/lib/app/versioning.js'

describe('bumpVersion', () => {
  it('increments like the portal (semver.inc)', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(() => bumpVersion('1.2', 'patch')).toThrow(/semver/i)
  })
})

describe('version list helpers', () => {
  const versions = [
    { _id: 'a', version: '1.0.0', status: 'deprecated' },
    { _id: 'b', version: '1.4.0', status: 'live' },
    { _id: 'c', version: '1.5.0', status: 'draft' },
    { _id: 'd', version: '1.2.0', status: 'disapproved' },
    { _id: 'e', version: '1.3.0', status: 'deprecating' }
  ]

  it('bases the bump on the highest non-draft, non-disapproved version', () => {
    expect(baseVersionFromList(versions)).toBe('1.4.0')
    expect(baseVersionFromList([{ _id: 'x', version: '0.1.0', status: 'draft' }])).toBeUndefined()
    expect(baseVersionFromList([])).toBeUndefined()
  })

  it('counts active versions and other versions in review', () => {
    expect(activeVersionCount(versions)).toBe(3)
    const withPending = [...versions, { _id: 'f', version: '1.4.1', status: 'inReview' }]
    expect(pendingVersions(withPending, 'c')).toHaveLength(2)
    expect(pendingVersions(withPending, 'f')).toHaveLength(2)
    expect(pendingVersions([...versions, { _id: 'g', status: 'in-review' }], 'c')).toHaveLength(2)
  })

  it('allows cloning only from the latest live version when no pending version exists', () => {
    const cloneable = [
      { _id: 'old', version: '1.0.0', status: 'live' },
      { _id: 'latest', version: '1.1.0', status: 'live' }
    ]
    expect(() => requireDraftable(cloneable, 'latest')).not.toThrow()
    expect(() => requireDraftable(cloneable, 'old')).toThrow(/latest live version/i)
    expect(() =>
      requireDraftable([...cloneable, { _id: 'draft', version: '1.2.0', status: 'draft' }], 'latest')
    ).toThrow(/pending version/i)
    expect(() =>
      requireDraftable(
        [...cloneable, ...Array.from({ length: 6 }, (_, index) => ({ _id: `d${index}`, status: 'deprecated' }))],
        'latest'
      )
    ).toThrow(/at most 8 versions/i)
  })
})

describe('bumpOptions and validateNewVersion', () => {
  it('disables bumps below the analyze minimum', () => {
    const options = bumpOptions({ baseVersion: '1.2.3', minimumBump: 'minor', activeVersionCount: 1 })
    expect(options.find(option => option.type === 'patch')?.disabledReason).toMatch(/minor/i)
    expect(options.find(option => option.type === 'minor')?.disabledReason).toBeUndefined()
    expect(options.find(option => option.type === 'major')?.disabledReason).toBeUndefined()
  })

  it('disables major at the active-version cap, like the portal', () => {
    const options = bumpOptions({ baseVersion: '1.2.3', activeVersionCount: 7 })
    expect(options.find(option => option.type === 'major')?.disabledReason).toMatch(/active versions/i)
    expect(options.find(option => option.type === 'minor')?.disabledReason).toBeUndefined()
  })

  it('validates a user-provided version against the allowed increments', () => {
    const options = bumpOptions({ baseVersion: '1.2.3', minimumBump: 'minor', activeVersionCount: 1 })
    expect(validateNewVersion('1.3.0', options)).toBe(true)
    expect(validateNewVersion('2.0.0', options)).toBe(true)
    expect(validateNewVersion('1.2.4', options)).toMatch(/at least a minor/i)
    expect(validateNewVersion('3.0.0', options)).toMatch(/must be one of/i)
    expect(validateNewVersion('abc', options)).toMatch(/semver/i)
    expect(validateNewVersion('1'.repeat(33), options)).toMatch(/at most 32 characters/i)
  })

  it('applies the portal deprecate gating', () => {
    /* A lone version can always be deprecated. */
    expect(() => requireDeprecatable([{ _id: 'a', version: '1.0.0', status: 'live' }], 'a')).not.toThrow()

    /* The only live version among several cannot be deprecated. */
    expect(() =>
      requireDeprecatable(
        [
          { _id: 'a', version: '1.0.0', status: 'live' },
          { _id: 'b', version: '1.1.0', status: 'draft' }
        ],
        'a'
      )
    ).toThrow(/only live version/i)

    /* Older live versions can go; the semver-latest live one cannot. */
    const twoLive = [
      { _id: 'a', version: '1.0.0', status: 'live' },
      { _id: 'b', version: '1.1.0', status: 'live' }
    ]
    expect(() => requireDeprecatable(twoLive, 'a')).not.toThrow()
    expect(() => requireDeprecatable(twoLive, 'b')).toThrow(/latest live/i)

    /* The active-version cap blocks further deprecations. */
    const many = [
      ...Array.from({ length: 7 }, (_, index) => ({
        _id: `v${index}`,
        version: `1.${index}.0`,
        status: index < 2 ? 'live' : 'deprecated'
      })),
      { _id: 'sel', version: '0.9.0', status: 'live' }
    ]
    expect(() => requireDeprecatable(many, 'sel')).toThrow(/at most 7/i)
  })

  it('reads the minimum bump from camelCase or snake_case analyze responses', () => {
    expect(minimumBumpFromAnalysis({ updateType: 'minor' })).toBe('minor')
    expect(minimumBumpFromAnalysis({ update_type: 'major' })).toBe('major')
    expect(minimumBumpFromAnalysis({ updateType: 'weird' })).toBeUndefined()
    expect(minimumBumpFromAnalysis(undefined)).toBeUndefined()
  })
})
