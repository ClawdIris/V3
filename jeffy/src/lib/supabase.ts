import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.generated';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { env } from './env';
import { secureSessionStorage } from './secure-session';

/**
 * The single Supabase client.
 *
 * The session lives in the iOS keychain rather than AsyncStorage, so a stolen
 * device backup does not hand over a valid refresh token, and so the biometric
 * lock has something worth guarding.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  env.supabaseUrl,
  env.supabaseAnonKey,
  {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    // On the web, OAuth and password-recovery redirects land with tokens in
    // the URL fragment and this is what consumes them. On native there is no
    // URL, and leaving it on makes the client wait on a browser API that
    // never resolves.
    detectSessionInUrl: Platform.OS === 'web',
  },
  global: {
    headers: { 'x-client-info': 'jeffy-ios' },
  },
  },
);

/**
 * Supabase refreshes tokens on a timer, which iOS suspends in the background.
 * Without this the first request after a long background is made with an
 * expired token. Registered once, at module scope, for the app's lifetime.
 */
let appStateSubscription: { remove: () => void } | null = null;

export function startSupabaseAutoRefresh(): () => void {
  const handle = (state: AppStateStatus): void => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };

  handle(AppState.currentState);
  appStateSubscription = AppState.addEventListener('change', handle);

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    void supabase.auth.stopAutoRefresh();
  };
}
