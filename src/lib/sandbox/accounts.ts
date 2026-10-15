import { randomInt } from 'node:crypto'

import type { ApiClient } from '../api/client.js'
import type { SandboxAccount } from '../api/types.js'
import { removeSecrets, type SecretEntry, tryRecordSecret } from '../secrets/ledger.js'
import { errorMessage } from '../shared/errors.js'

/* One character from each class the portal requires, then random fill;
   look-alike characters are left out so a revealed password is easy to type. */
const PASSWORD_CLASSES = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?']
const PASSWORD_LENGTH = 20

function pick(characters: string): string {
  return characters[randomInt(characters.length)]
}

/* A strong sandbox password generated locally, so it never passes through
   a prompt, a model, or tool arguments. */
export function generateSandboxPassword(): string {
  const all = PASSWORD_CLASSES.join('')
  const characters = [
    ...PASSWORD_CLASSES.map(pick),
    ...Array.from({ length: PASSWORD_LENGTH - PASSWORD_CLASSES.length }, () => pick(all))
  ]
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1)
    ;[characters[index], characters[swap]] = [characters[swap], characters[index]]
  }
  return characters.join('')
}

export function sandboxPasswordEntry(
  account: SandboxAccount,
  name: string,
  password: string
): Omit<SecretEntry, 'createdAt'> {
  return { kind: 'sandbox-password', label: account.name ?? name, reference: account.companyId, value: password }
}

export function findSandbox(accounts: readonly SandboxAccount[], id: string): SandboxAccount | undefined {
  return accounts.find(account => account._id && (account.companyId === id || account._id === id))
}

/* Creates a sandbox whose password is only kept in the local ledger; a
   sandbox whose password cannot be kept is deleted again. */
export async function createSandboxInLedger(
  client: ApiClient,
  configDir: string,
  name: string
): Promise<SandboxAccount> {
  const password = generateSandboxPassword()
  const account = await client.createSandboxAccount(name, password)
  if (await tryRecordSecret(configDir, client.activeProfileName, sandboxPasswordEntry(account, name, password))) {
    return account
  }
  const kept = `Sandbox ${account.companyId ?? account.name ?? name} was created, but its password could not be saved locally`
  if (!account._id) throw new Error(`${kept} and it could not be deleted again. Delete it with \`ghl sandbox delete\`.`)
  try {
    await client.deleteSandboxAccount(account._id)
  } catch (error) {
    throw new Error(
      `${kept} and it could not be deleted again (${errorMessage(error, 'unknown error')}). Delete it with \`ghl sandbox delete\`.`
    )
  }
  throw new Error('The sandbox password could not be saved locally, so the new sandbox was deleted again.')
}

/* Deletes the sandbox, then prunes its password from the ledger. Returns
   false when only the ledger update failed. */
export async function deleteSandboxAndSecret(
  client: ApiClient,
  configDir: string,
  account: SandboxAccount
): Promise<boolean> {
  if (!account._id) throw new Error('The sandbox account has no id.')
  await client.deleteSandboxAccount(account._id)
  try {
    await removeSecrets(configDir, client.activeProfileName, { kind: 'sandbox-password', reference: account.companyId })
    return true
  } catch {
    return false
  }
}
