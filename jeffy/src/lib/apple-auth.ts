import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * Sign in with Apple, native build.
 *
 * Isolated here so the web bundle (apple-auth.web.ts) never imports
 * expo-apple-authentication, which has no web implementation.
 */

export type AppleSignInKind = 'native' | 'web';
export const appleSignInKind: AppleSignInKind = 'native';

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync();
}

/** Resolves when Supabase has a session. Throws on failure or cancellation. */
export async function signInWithApple(): Promise<void> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  if (credential.identityToken === null) {
    throw new Error('Apple did not return an identity token.');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error !== null) throw error;

  // Apple hands over the name only on the very first authorisation, so if we
  // do not capture it now it is gone for good.
  const fullName = credential.fullName;
  if (fullName !== null) {
    const name = [fullName.givenName, fullName.familyName]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' ');
    if (name.length > 0) {
      await supabase.auth.updateUser({ data: { display_name: name } });
      const { data } = await supabase.auth.getUser();
      if (data.user !== null) {
        await supabase
          .from('profiles')
          .update({ display_name: name })
          .eq('id', data.user.id)
          .is('display_name', null);
      }
    }
  }
}

export const AppleAuthenticationModule: typeof AppleAuthentication | null = AppleAuthentication;
