import { useRouter, useSegments } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { LockScreen } from './lock-screen';
import { useProfile } from '@/features/profile/use-profile';
import { useAppLock } from '@/providers/app-lock-provider';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';

/**
 * Decides which part of the app the user is allowed to be in.
 *
 * Kept in one place rather than spread across per-route guards, because the
 * ordering matters and is easy to get subtly wrong: the lock must win over
 * everything, including onboarding, or a locked device leaks the profile
 * screen. The order is:
 *
 *   1. still loading          -> spinner
 *   2. locked                 -> lock screen, rendered INSTEAD of the app
 *   3. signed out             -> (auth)
 *   4. signed in, no profile  -> onboarding
 *   5. otherwise              -> (tabs)
 */
export function AuthGate({ children }: { children: ReactNode }): React.JSX.Element {
  const { status } = useAuth();
  const { isLocked } = useAppLock();
  const { profile, isLoading: profileLoading } = useProfile();
  const segments = useSegments();
  const router = useRouter();

  const group = segments[0];
  const inAuthGroup = group === '(auth)';
  const inOnboarding = group === 'onboarding';

  const needsOnboarding = profile !== null && profile.onboarded_at === null;
  const ready = status !== 'loading' && !(status === 'signed-in' && profileLoading);

  useEffect(() => {
    if (!ready || isLocked) return;

    if (status === 'signed-out') {
      if (!inAuthGroup) router.replace('/(auth)/sign-in');
      return;
    }

    if (needsOnboarding) {
      if (!inOnboarding) router.replace('/onboarding');
      return;
    }

    if (inAuthGroup || inOnboarding) router.replace('/(tabs)');
  }, [ready, isLocked, status, needsOnboarding, inAuthGroup, inOnboarding, router]);

  if (!ready) return <Splash />;

  // Rendered in place of the navigator, not on top of it: a locked app must
  // not have the closet mounted behind a translucent sheet where a screenshot
  // or the app switcher could reveal it.
  if (isLocked) return <LockScreen />;

  return <>{children}</>;
}

function Splash(): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
      }}
    >
      <ActivityIndicator color={colors.textMuted} />
    </View>
  );
}
