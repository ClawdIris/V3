import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { describeAuthError } from '@/features/auth/errors';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/use-theme';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Where the password-reset email lands.
 *
 * Supabase redirects here with a recovery token in the URL; the client
 * consumes it (detectSessionInUrl on web) and fires PASSWORD_RECOVERY, at
 * which point the user is signed in with a session that exists only to set a
 * new password.
 */
export default function ResetPasswordScreen(): React.JSX.Element {
  const router = useRouter();
  const { spacing } = useTheme();

  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The event may already have fired before this screen mounted, so also
    // check for a session directly.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session !== null) setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError !== null) throw updateError;
      setDone(true);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md }}>
        <Text variant="title">Choose a new password</Text>

        {done ? (
          <>
            <Text variant="body" tone="muted">
              Done. You are signed in.
            </Text>
            <View style={{ height: spacing.lg }} />
            <Button title="Open Jeffy" onPress={() => router.replace('/(tabs)')} />
          </>
        ) : !ready ? (
          <Text variant="body" tone="muted">
            Checking your reset link… If this does not change, the link may have expired —
            request a new one from the sign-in screen.
          </Text>
        ) : (
          <>
            <Field
              label="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            />
            {error !== null ? (
              <Text variant="caption" tone="danger">
                {error}
              </Text>
            ) : null}
            <Button
              title="Save password"
              onPress={() => void submit()}
              loading={busy}
              disabled={password.length < MIN_PASSWORD_LENGTH}
            />
          </>
        )}
      </View>
    </Screen>
  );
}
