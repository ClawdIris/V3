import * as LocalAuthentication from 'expo-local-authentication';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  DEFAULT_LOCK_TIMEOUT_SECONDS,
  readLockSettings,
  writeLockEnabled,
  writeLockTimeout,
  type LockSettings,
} from '@/lib/lock-settings';

/**
 * Biometric app lock.
 *
 * Locks on cold launch and whenever the app has been in the background longer
 * than the configured timeout. The session itself stays in the keychain, so
 * unlocking never asks for a password again -- biometrics gate access to a
 * session that is already there.
 *
 * Two deliberate choices:
 *  - The backgrounded-at timestamp is kept in memory only. A killed app is a
 *    cold launch, which locks unconditionally, so there is nothing to persist.
 *  - A failed or cancelled prompt leaves the app locked. There is no "skip".
 *    Turning the lock off is done in settings, while unlocked.
 */

export interface AppLockState {
  readonly isLocked: boolean;
  readonly isEnabled: boolean;
  readonly timeoutSeconds: number;
  readonly isSupported: boolean;
  readonly isEnrolled: boolean;
  /** 'face' | 'fingerprint' | 'passcode' | null — drives the copy and icon. */
  readonly method: LockMethod | null;
  readonly hasPrompted: boolean;
}

export type LockMethod = 'face' | 'fingerprint' | 'iris' | 'passcode';

export interface AppLockActions {
  unlock(): Promise<boolean>;
  enable(): Promise<boolean>;
  disable(): Promise<void>;
  setTimeout(seconds: number): Promise<void>;
  markPrompted(): Promise<void>;
  /** Locks now — used when signing out of a second account, and by tests. */
  lockNow(): void;
}

type AppLockContextValue = AppLockState & AppLockActions;

const AppLockContext = createContext<AppLockContextValue | null>(null);

async function detectMethod(): Promise<LockMethod | null> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
  return null;
}

export function AppLockProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<LockSettings>({
    enabled: false,
    timeoutSeconds: DEFAULT_LOCK_TIMEOUT_SECONDS,
    prompted: false,
  });
  const [isLocked, setLocked] = useState(false);
  const [isSupported, setSupported] = useState(false);
  const [isEnrolled, setEnrolled] = useState(false);
  const [method, setMethod] = useState<LockMethod | null>(null);

  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [stored, hardware, enrolled, detected] = await Promise.all([
        readLockSettings(),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        detectMethod(),
      ]);
      if (cancelled) return;

      setSettings(stored);
      setSupported(hardware);
      setEnrolled(enrolled);
      // Device passcode is the documented fallback when no biometric is
      // enrolled but the hardware exists.
      setMethod(detected ?? (hardware ? 'passcode' : null));

      // Cold launch with the lock on: locked before the first frame of content.
      if (stored.enabled && hardware) setLocked(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handle = (next: AppStateStatus): void => {
      if (next === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;

        if (!settings.enabled || since === null) return;
        const awaySeconds = (Date.now() - since) / 1000;
        if (awaySeconds >= settings.timeoutSeconds) setLocked(true);
        return;
      }

      // 'inactive' fires for the app switcher and for a notification banner,
      // so only a real background starts the clock. Recording the first one
      // wins avoids a quick inactive->background flicker resetting it.
      if (next === 'background' && backgroundedAt.current === null) {
        backgroundedAt.current = Date.now();
      }
    };

    const subscription = AppState.addEventListener('change', handle);
    return () => subscription.remove();
  }, [settings.enabled, settings.timeoutSeconds]);

  const authenticate = useCallback(async (prompt: string): Promise<boolean> => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      // Let iOS fall back to the device passcode: a user whose Face ID fails
      // in the dark must still be able to get into their own closet.
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    return result.success;
  }, []);

  const actions = useMemo<AppLockActions>(
    () => ({
      async unlock() {
        const ok = await authenticate('Unlock Jeffy');
        if (ok) setLocked(false);
        return ok;
      },

      async enable() {
        // Prove the user can satisfy the prompt before turning the lock on,
        // otherwise we can lock someone out of their own app.
        const ok = await authenticate('Turn on the Jeffy lock');
        if (!ok) return false;
        await writeLockEnabled(true);
        setSettings((s) => ({ ...s, enabled: true }));
        return true;
      },

      async disable() {
        await writeLockEnabled(false);
        setSettings((s) => ({ ...s, enabled: false }));
        setLocked(false);
      },

      async setTimeout(seconds) {
        await writeLockTimeout(seconds);
        setSettings((s) => ({ ...s, timeoutSeconds: Math.max(0, Math.floor(seconds)) }));
      },

      async markPrompted() {
        const { markLockPrompted } = await import('@/lib/lock-settings');
        await markLockPrompted();
        setSettings((s) => ({ ...s, prompted: true }));
      },

      lockNow() {
        setLocked(true);
      },
    }),
    [authenticate],
  );

  const value = useMemo<AppLockContextValue>(
    () => ({
      isLocked,
      isEnabled: settings.enabled,
      timeoutSeconds: settings.timeoutSeconds,
      hasPrompted: settings.prompted,
      isSupported,
      isEnrolled,
      method,
      ...actions,
    }),
    [isLocked, settings, isSupported, isEnrolled, method, actions],
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockContextValue {
  const context = useContext(AppLockContext);
  if (context === null) throw new Error('useAppLock must be used inside <AppLockProvider>');
  return context;
}
