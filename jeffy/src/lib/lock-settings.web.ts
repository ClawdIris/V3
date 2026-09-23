/**
 * Web build of the lock preferences.
 *
 * The biometric lock does not exist on the web (expo-local-authentication
 * reports no hardware there), so these only need to satisfy the interface.
 * They persist to localStorage so that a future WebAuthn-based lock has
 * somewhere to keep its toggle.
 */

const ENABLED_KEY = 'jeffy.lock.enabled';
const TIMEOUT_KEY = 'jeffy.lock.timeoutSeconds';
const PROMPTED_KEY = 'jeffy.lock.prompted';

export const DEFAULT_LOCK_TIMEOUT_SECONDS = 5 * 60;

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
  readonly prompted: boolean;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the setting simply does not persist.
  }
}

export async function readLockSettings(): Promise<LockSettings> {
  const parsed = Number.parseInt(read(TIMEOUT_KEY) ?? '', 10);
  return {
    enabled: read(ENABLED_KEY) === 'true',
    timeoutSeconds:
      Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LOCK_TIMEOUT_SECONDS,
    prompted: read(PROMPTED_KEY) === 'true',
  };
}

export async function writeLockEnabled(enabled: boolean): Promise<void> {
  write(ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function writeLockTimeout(seconds: number): Promise<void> {
  write(TIMEOUT_KEY, String(Math.max(0, Math.floor(seconds))));
}

export async function markLockPrompted(): Promise<void> {
  write(PROMPTED_KEY, 'true');
}
