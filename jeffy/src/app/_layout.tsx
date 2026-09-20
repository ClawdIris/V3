import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthGate } from '@/features/auth/auth-gate';
import { queryClient, queryPersister } from '@/lib/query-client';
import { AppLockProvider } from '@/providers/app-lock-provider';
import { AuthProvider } from '@/providers/auth-provider';

export default function RootLayout(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            // Bump when a query's cached shape changes, so a stale cache is
            // discarded instead of rendering against the wrong types.
            buster: 'v1',
          }}
        >
          <AuthProvider>
            <AppLockProvider>
              <StatusBar style="auto" />
              <AuthGate>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="onboarding" />
                  <Stack.Screen name="join" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="capture" options={{ presentation: 'fullScreenModal' }} />
                  <Stack.Screen name="item/[id]" />
                </Stack>
              </AuthGate>
            </AppLockProvider>
          </AuthProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
