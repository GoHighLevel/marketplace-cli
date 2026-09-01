import { render } from '@inquirer/testing'
import { describe, expect, it } from 'vitest'

import { checkboxSearch, filterChoices } from '../../../src/lib/shared/checkbox-search.js'

const SCOPES = [
  { name: 'contacts.readonly', value: 'contacts.readonly', description: 'Read contacts' },
  { name: 'contacts.write', value: 'contacts.write', description: 'Write contacts' },
  { name: 'locations.readonly', value: 'locations.readonly', description: 'Read locations' },
  { name: 'calendars.readonly', value: 'calendars.readonly', description: 'Read calendars' }
]

describe('filterChoices', () => {
  it('matches case-insensitively against name and description', () => {
    expect(filterChoices(SCOPES, 'CONTACTS').map(choice => choice.value)).toEqual([
      'contacts.readonly',
      'contacts.write'
    ])
    expect(filterChoices(SCOPES, 'read contacts').map(choice => choice.value)).toEqual(['contacts.readonly'])
    expect(filterChoices(SCOPES, '')).toHaveLength(4)
    expect(filterChoices(SCOPES, 'nope')).toHaveLength(0)
  })
})

describe('checkboxSearch prompt', () => {
  it('narrows the list as the user types and toggles with space', async () => {
    const { answer, events, getScreen } = await render(checkboxSearch, {
      message: 'Which scopes should be added?',
      choices: SCOPES
    })

    expect(getScreen()).toContain('contacts.readonly')
    expect(getScreen()).toContain('calendars.readonly')

    events.type('loca')
    expect(getScreen()).toContain('locations.readonly')
    expect(getScreen()).not.toContain('calendars.readonly')

    events.keypress('space')
    expect(getScreen()).toContain('1 selected')

    events.keypress('enter')
    await expect(answer).resolves.toEqual(['locations.readonly'])
  })

  it('keeps selections made under different filters and validates on enter', async () => {
    const { answer, events, getScreen } = await render(checkboxSearch, {
      message: 'Pick scopes:',
      choices: SCOPES,
      validate: selection => (selection.length > 0 ? true : 'Select at least one scope.')
    })

    events.keypress('enter')
    expect(getScreen()).toContain('Select at least one scope.')

    events.type('contacts.w')
    events.keypress('space')
    for (let index = 0; index < 'contacts.w'.length; index += 1) events.keypress('backspace')
    events.type('calendars')
    events.keypress('space')
    events.keypress('enter')

    await expect(answer).resolves.toEqual(['contacts.write', 'calendars.readonly'])
  })

  it('shows a hint when nothing matches and recovers on backspace', async () => {
    const { answer, events, getScreen } = await render(checkboxSearch, {
      message: 'Pick scopes:',
      choices: SCOPES
    })

    events.type('zzz')
    expect(getScreen()).toContain('No matches')

    events.keypress('backspace')
    events.keypress('backspace')
    events.keypress('backspace')
    expect(getScreen()).toContain('contacts.readonly')

    events.keypress('space')
    events.keypress('enter')
    await expect(answer).resolves.toEqual(['contacts.readonly'])
  })

  it('navigates with arrows without polluting the filter', async () => {
    const { answer, events, getScreen } = await render(checkboxSearch, {
      message: 'Pick scopes:',
      choices: SCOPES
    })

    events.keypress('down')
    events.keypress('space')
    expect(getScreen()).toContain('1 selected')

    events.keypress('enter')
    await expect(answer).resolves.toEqual(['contacts.write'])
  })
})
