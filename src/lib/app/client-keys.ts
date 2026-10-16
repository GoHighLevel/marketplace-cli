import type { AppVersion, ClientKeyCreated } from '../api/types.js'
import { removeSecrets, type SecretEntry, tryRecordSecret } from '../secrets/ledger.js'
import { CodedError, errorMessage } from '../shared/errors.js'
import type { AppContext } from './section-context.js'

export function liveClientKeys(version: AppVersion): Array<{ id: string; name?: string }> {
  return (version.clientKeys ?? []).flatMap(key => (key.id && !key.deleted ? [{ id: key.id, name: key.name }] : []))
}

export function requireClientKey(version: AppVersion, keyId: string): void {
  if (!liveClientKeys(version).some(key => key.id === keyId)) {
    throw new CodedError('NOT_FOUND', `Client key "${keyId}" was not found on the selected app.`)
  }
}

export function clientSecretEntry(
  appId: string,
  name: string,
  created: ClientKeyCreated
): Omit<SecretEntry, 'createdAt'> {
  return { kind: 'client-secret', label: name, reference: created.id, appId, value: created.secret }
}

/* For callers that must never see the secret: it is only kept in the local
   ledger, and a key whose secret cannot be kept is deleted again. Returns
   the client id. */
export async function createClientKeyInLedger(context: AppContext, name: string): Promise<string> {
  const { client, config, selected } = context
  const created = await client.addClientKey(selected.appId, name)
  if (
    await tryRecordSecret(config.configDir, client.activeProfileName, clientSecretEntry(selected.appId, name, created))
  ) {
    return created.id
  }
  try {
    await client.deleteClientKey(selected.appId, created.id)
  } catch (error) {
    throw new Error(
      `Client key ${created.id} was created, but its secret could not be saved locally and the key could not be deleted again (${errorMessage(error, 'unknown error')}). Delete it with \`ghl app keys delete ${created.id}\`.`
    )
  }
  throw new Error('The client secret could not be saved locally, so the new key was deleted again. Nothing changed.')
}

/* Deletes the key, then prunes its now-useless secret from the ledger.
   Returns false when only the ledger update failed. */
export async function deleteClientKeyAndSecret(context: AppContext, keyId: string): Promise<boolean> {
  requireClientKey(context.version, keyId)
  await context.client.deleteClientKey(context.selected.appId, keyId)
  try {
    await removeSecrets(context.config.configDir, context.client.activeProfileName, {
      kind: 'client-secret',
      reference: keyId
    })
    return true
  } catch {
    return false
  }
}
