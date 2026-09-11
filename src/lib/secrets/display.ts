import { isAppScoped, maskSecret, type SecretEntry, type SecretKind, secretAppId } from './ledger.js'

interface KindMeta {
  header: string
  nameLabel: string
  referenceLabel: string
  valueLabel: string
}

const KIND_ORDER: SecretKind[] = ['client-secret', 'sso-key', 'sandbox-password']

const KIND_META: Record<SecretKind, KindMeta> = {
  'client-secret': {
    header: 'Client keys:',
    nameLabel: 'Name',
    referenceLabel: 'Client ID',
    valueLabel: 'Client secret'
  },
  'sso-key': { header: 'SSO keys:', nameLabel: 'App', referenceLabel: 'App ID', valueLabel: 'SSO key' },
  'sandbox-password': {
    header: 'Sandbox passwords:',
    nameLabel: 'Account',
    referenceLabel: 'Company ID',
    valueLabel: 'Password'
  }
}

export function isSecretInScope(entry: SecretEntry, appId?: string, includeAccount = false): boolean {
  if (!appId) return !isAppScoped(entry)
  return isAppScoped(entry) ? secretAppId(entry) === appId : includeAccount
}

export function scopeSecretEntries(entries: SecretEntry[], appId?: string, includeAccount = false) {
  const appEntries = appId ? entries.filter(entry => isAppScoped(entry) && secretAppId(entry) === appId) : []
  const accountEntries = entries.filter(entry => !isAppScoped(entry))
  const visible = appId ? [...appEntries, ...(includeAccount ? accountEntries : [])] : accountEntries
  return { appEntries, accountEntries, visible }
}

/* Renders ledger entries grouped by kind with human field labels:
   "Client keys:" then Name / Client ID / Client secret lines. */
export function renderSecretEntries(entries: SecretEntry[], reveal: boolean): string[] {
  const lines: string[] = []
  for (const kind of KIND_ORDER) {
    const group = entries.filter(entry => entry.kind === kind)
    if (group.length === 0) continue

    const meta = KIND_META[kind]
    if (lines.length > 0) lines.push('')
    lines.push(meta.header)

    group.forEach((entry, index) => {
      if (index > 0) lines.push('')
      const field = (label: string, value: string) => lines.push(`  ${`${label}:`.padEnd(14)} ${value}`)
      field(meta.nameLabel, entry.label)
      if (entry.reference) field(meta.referenceLabel, entry.reference)
      field(meta.valueLabel, reveal ? entry.value : maskSecret(entry.value))
      field('Created', entry.createdAt.slice(0, 19).replace('T', ' '))
    })
  }
  return lines
}
