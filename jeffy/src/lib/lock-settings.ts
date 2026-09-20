import * as SecureStore from 'expo-secure-store';

/**
 * Biometric-lock preferences.
 *
 * Stored in SecureStore rather than AsyncStorage so the setting cannot be
 * flipped off by anything that can write app storage: turning the lock off is
 * a security decision and belongs behind the keychain with the session.
 */

const ENABLED_KEY = 'jeffy.lock.enabled';
const TIMEOUT_KEY = 'jeffy.lock.timeoutSeconds';
const PROMPTED_KEY = 'jeffy.lock.prompted';

export const DEFAULT_LOCK_TIMEOUT_SECONDS = 5 * 60;

/** Offered in settings. 0 means lock the moment the app leaves the foreground. */
export const LOCK_TIMEOUT_CHOICES = [
  { label: 'Immediately', seconds: 0 },
  { label: 'After 1 minute', seconds: 60 },
  { label: 'After 5 minutes', seconds: 300 },
  { label: 'After 15 minutes', seconds: 900 },
  { label: 'After 1 hour', seconds: 3600 },
] as const;

export interface LockSettings {
  readonly enabled: boolean;
  readonly timeoutSeconds: number;
  /** Whether we have already offered to turn the lock on. */
  readonly prompted: boolean;
}

export async function readLockSettings(): Promise<LockSettings> {
  const [enabled, timeout, prompted] = await Promise.all([
    SecureStore.getItemAsync(ENABLED_KEY),
    SecureStore.getItemAsync(TIMEOUT_KEY),
    SecureStore.getItemAsync(PROMPTED_KEY),
  ]);

  const parsed = timeout === null ? Number.NaN : Number.parseInt(timeout, 10);

  return {
    enabled: enabled === 'true',
    timeoutSeconds:
      Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LOCK_TIMEOUT_SECONDS,
    prompted: prompted === 'true',
  };
}

export async function writeLockEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function writeLockTimeout(seconds: number): Promise<void> {
  await SecureStore.setItemAsync(TIMEOUT_KEY, String(Math.max(0, Math.floor(seconds))));
}

export async function markLockPrompted(): Promise<void> {
  await SecureStore.setItemAsync(PROMPTED_KEY, 'true');
}
