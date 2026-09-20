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

const MIN_PASSWORD_LENGTH = 8;

export default function SignUpScreen(): React.JSX.Element {
  const { signUp } = useAuth();
  const { spacing } = useTheme();
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const nameInvalid = displayName.trim().length === 0;
  const passwordInvalid = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const submit = async (): Promise<void> => {
    if (nameInvalid || passwordInvalid) return;
    setError(null);
    setBusy(true);
    try {
      await signUp(email, password, displayName);
      // Supabase sends a confirmation mail; there is no session until it is
      // clicked, so tell the user rather than dropping them on a blank app.
      setSent(true);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.md }}>
          <Text variant="title">Check your email</Text>
          <Text variant="body" tone="muted">
            We sent a confirmation link to {email.trim()}. Tap it, then come back and sign in.
          </Text>
          <View style={{ height: spacing.lg }} />
          <Button title="Back to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xs, marginTop: spacing.xxl, marginBottom: spacing.xl }}>
        <Text variant="title">Create your account</Text>
        <Text variant="body" tone="muted">
          You get your own closet. You can invite a stylist later.
        </Text>
      </View>

      <Field
        label="Name"
        value={displayName}
        onChangeText={setDisplayName}
        autoComplete="name"
        textContentType="name"
        placeholder="What your stylist should call you"
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={passwordInvalid ? `At least ${MIN_PASSWORD_LENGTH} characters.` : null}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      />

      {error !== null ? (
        <Text variant="caption" tone="danger" style={{ marginBottom: spacing.md }}>
          {error}
        </Text>
      ) : null}

      <Button
        title="Create account"
        onPress={() => void submit()}
        loading={busy}
        disabled={nameInvalid || password.length < MIN_PASSWORD_LENGTH || email.trim().length === 0}
      />

      <Text
        variant="label"
        tone="accent"
        onPress={() => router.replace('/(auth)/sign-in')}
        style={{ textAlign: 'center', marginTop: spacing.xl }}
      >
        I already have an account
      </Text>
    </Screen>
  );
}
