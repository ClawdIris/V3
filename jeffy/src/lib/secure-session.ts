import * as SecureStore from 'expo-secure-store';

/**
 * A SecureStore-backed storage adapter for the Supabase auth session.
 *
 * The iOS keychain rejects values over roughly 2 KB, and a Supabase session
 * (access token + refresh token + user metadata) routinely exceeds that once
 * a user has any metadata at all. SecureStore's own error for this is opaque,
 * and the failure mode is a session that silently never persists — the user
 * gets logged out on every cold launch.
 *
 * So values are split across numbered keys, with the head key holding a small
 * manifest. Tokens are base64url, i.e. single-byte characters, so a character
 * budget is a byte budget here.
 */

const CHUNK_SIZE = 1536;
const MANIFEST_PREFIX = '__jeffy_chunks__:';

/**
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY: the session is readable only while the
 * device is unlocked, and is excluded from iCloud keychain backups, so it
 * cannot be restored onto a different device.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const chunkKey = (key: string, index: number): string => `${key}.${index}`;

async function clearChunks(key: string, count: number): Promise<void> {
  const deletions: Promise<void>[] = [];
  for (let i = 0; i < count; i += 1) {
    deletions.push(SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS));
  }
  await Promise.all(deletions);
}

async function readManifest(key: string): Promise<number | null> {
  const head = await SecureStore.getItemAsync(key, OPTIONS);
  if (head === null || !head.startsWith(MANIFEST_PREFIX)) return null;
  const count = Number.parseInt(head.slice(MANIFEST_PREFIX.length), 10);
  return Number.isFinite(count) && count > 0 ? count : null;
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key, OPTIONS);
    if (head === null) return null;

    // Small values are stored inline, with no manifest.
    if (!head.startsWith(MANIFEST_PREFIX)) return head;

    const count = Number.parseInt(head.slice(MANIFEST_PREFIX.length), 10);
    if (!Number.isFinite(count) || count <= 0) return null;

    const parts = await Promise.all(
      Array.from({ length: count }, (_unused, i) =>
        SecureStore.getItemAsync(chunkKey(key, i), OPTIONS),
      ),
    );

    // A partial write (app killed mid-save, keychain evicted) must read as
    // "no session" rather than as a corrupt token the client would retry with.
    if (parts.some((part) => part === null)) {
      await this.removeItem(key);
      return null;
    }

    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await readManifest(key);
    if (previous !== null) await clearChunks(key, previous);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value, OPTIONS);
      return;
    }

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }

    // Chunks first, manifest last: if this is interrupted, the head key still
    // points at the previous complete value or at nothing, never at a
    // half-written one.
    await Promise.all(
      chunks.map((chunk, i) => SecureStore.setItemAsync(chunkKey(key, i), chunk, OPTIONS)),
    );
    await SecureStore.setItemAsync(key, `${MANIFEST_PREFIX}${chunks.length}`, OPTIONS);
  },

  async removeItem(key: string): Promise<void> {
    const count = await readManifest(key);
    if (count !== null) await clearChunks(key, count);
    await SecureStore.deleteItemAsync(key, OPTIONS);
  },
};
