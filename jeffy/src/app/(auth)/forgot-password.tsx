import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { describeAuthError } from '@/features/auth/errors';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';

export default function ForgotPasswordScreen(): React.JSX.Element {
  const { sendPasswordReset } = useAuth();
  const { spacing } = useTheme();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md }}>
        <Text variant="title">Reset your password</Text>

        {sent ? (
          <>
            <Text variant="body" tone="muted">
              If there is an account for {email.trim()}, a reset link is on its way.
            </Text>
            <View style={{ height: spacing.lg }} />
            <Button title="Back to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
          </>
        ) : (
          <>
            <Text variant="body" tone="muted">
              We will email you a link to set a new one.
            </Text>
            <View style={{ height: spacing.md }} />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            {error !== null ? (
              <Text variant="caption" tone="danger">
                {error}
              </Text>
            ) : null}
            <Button
              title="Send reset link"
              onPress={() => void submit()}
              loading={busy}
              disabled={email.trim().length === 0}
            />
            <Button title="Back" variant="ghost" onPress={() => router.back()} />
          </>
        )}
      </View>
    </Screen>
  );
}
