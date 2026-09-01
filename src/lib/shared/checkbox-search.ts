import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isTabKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePagination,
  usePrefix,
  useRef,
  useState
} from '@inquirer/core'
import { styleText } from 'node:util'

export interface SearchableChoice<Value> {
  name: string
  value: Value
  description?: string
}

export interface CheckboxSearchConfig<Value> {
  message: string
  choices: SearchableChoice<Value>[]
  pageSize?: number
  validate?: (selection: Value[]) => true | string
}

export function filterChoices<Value>(choices: SearchableChoice<Value>[], filter: string): SearchableChoice<Value>[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) return choices
  return choices.filter(choice => `${choice.name} ${choice.description ?? ''}`.toLowerCase().includes(needle))
}

/* A checkbox prompt with type-to-filter, which @inquirer/prompts lacks:
   printable keys narrow the list, space/tab toggles, enter confirms. */
const prompt = createPrompt<unknown[], CheckboxSearchConfig<unknown>>((config, done) => {
  const { pageSize = 12 } = config
  const theme = makeTheme()
  const [status, setStatus] = useState<'idle' | 'done'>('idle')
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  const [selectedIndexes, setSelectedIndexes] = useState<readonly number[]>([])
  const selectedIndexesRef = useRef(selectedIndexes)
  const [error, setError] = useState<string>()
  const prefix = usePrefix({ status, theme })

  const indexed = config.choices.map((choice, index) => ({ choice, index }))
  const filtered = indexed.filter(({ choice }) => filterChoices([choice], filter).length > 0)
  const cursor = Math.min(active, Math.max(filtered.length - 1, 0))

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      rl.clearLine(0)
      rl.write(filter)
      const values = selectedIndexesRef.current.map(index => config.choices[index].value)
      const validation = config.validate?.(values) ?? true
      if (validation !== true) {
        setError(validation)
        return
      }
      setStatus('done')
      done(values)
      return
    }
    if (isUpKey(key) || isDownKey(key)) {
      rl.clearLine(0)
      rl.write(filter)
      if (filtered.length > 0) {
        const offset = isUpKey(key) ? -1 : 1
        setActive((cursor + offset + filtered.length) % filtered.length)
      }
      return
    }
    if (isSpaceKey(key) || isTabKey(key)) {
      rl.clearLine(0)
      rl.write(filter)
      const item = filtered[cursor]
      if (item) {
        setError(undefined)
        const nextSelection = selectedIndexesRef.current.includes(item.index)
          ? selectedIndexesRef.current.filter(index => index !== item.index)
          : [...selectedIndexesRef.current, item.index]
        selectedIndexesRef.current = nextSelection
        setSelectedIndexes(nextSelection)
      }
      return
    }

    const nextFilter = isBackspaceKey(key) && rl.line === filter ? filter.slice(0, -1) : rl.line
    if (nextFilter !== rl.line) {
      rl.clearLine(0)
      rl.write(nextFilter)
    }
    setError(undefined)
    setFilter(nextFilter)
    setActive(0)
  })

  const message = theme.style.message(config.message, status)

  const page = usePagination({
    items: filtered,
    active: cursor,
    renderItem({ item, isActive }) {
      const marker = selectedIndexes.includes(item.index) ? styleText('green', '◉') : '◯'
      const pointer = isActive ? styleText('cyan', '❯') : ' '
      const label = isActive ? theme.style.highlight(item.choice.name) : item.choice.name
      return `${pointer} ${marker} ${label}`
    },
    pageSize,
    loop: false
  })

  if (status === 'done') {
    const names = selectedIndexes.map(index => config.choices[index].name)
    return `${prefix} ${message} ${theme.style.answer(names.join(', '))}`
  }

  const filterText = filter ? styleText('cyan', filter) : ''
  const header = [prefix, message, filterText].filter(Boolean).join(' ')
  const count = selectedIndexes.length > 0 ? styleText('dim', `${selectedIndexes.length} selected`) : ''
  const description = filtered[cursor]?.choice.description
  const body =
    filtered.length === 0
      ? theme.style.error('No matches — press backspace to widen the filter.')
      : page
  const footer = [
    description ? styleText('cyan', description) : '',
    error ? theme.style.error(error) : '',
    [count, styleText('dim', 'type to filter · space to select · enter to confirm · esc to cancel')].filter(Boolean).join(styleText('dim', ' · '))
  ]
    .filter(Boolean)
    .join('\n')

  return [header, [body, footer].filter(Boolean).join('\n')]
})

export function checkboxSearch<Value>(
  config: CheckboxSearchConfig<Value>,
  context?: Parameters<typeof prompt>[1]
): Promise<Value[]> {
  return prompt(config as CheckboxSearchConfig<unknown>, context) as Promise<Value[]>
}
