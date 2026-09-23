import { supabase } from './supabase';

/**
 * Sign in with Apple, web build: a standard OAuth redirect through Supabase.
 *
 * The browser leaves the page, Apple authenticates, Supabase sets the session
 * and redirects back; detectSessionInUrl picks it up on return. Needs the
 * Apple provider configured in the Supabase dashboard, exactly as native does.
 */

export type AppleSignInKind = 'native' | 'web';
export const appleSignInKind: AppleSignInKind = 'web';

export async function isAppleSignInAvailable(): Promise<boolean> {
  return true;
}

export async function signInWithApple(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: window.location.origin },
  });
  if (error !== null) throw error;
}

// The native button component does not exist on web; sign-in.tsx checks
// appleSignInKind and renders a plain Button instead. Type-only import: it
// never pulls the module into the web bundle.
export const AppleAuthenticationModule: typeof import('expo-apple-authentication') | null = null;
