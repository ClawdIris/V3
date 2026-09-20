import * as AppleAuthentication from 'expo-apple-authentication';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { describeAuthError } from '@/features/auth/errors';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';

export default function SignInScreen(): React.JSX.Element {
  const { signIn, signInWithApple, isAppleAvailable } = useAuth();
  const { spacing } = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(describeAuthError(cause));
    } finally {
      setBusy(false);
    }
  };

  const withApple = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await signInWithApple();
    } catch (cause) {
      // Tapping cancel on the Apple sheet is not an error worth shouting about.
      const message = describeAuthError(cause);
      if (message !== null) setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xs, marginTop: spacing.xxxl, marginBottom: spacing.xxl }}>
        <Text variant="display">Jeffy</Text>
        <Text variant="body" tone="muted">
          Your closet, and someone with taste.
        </Text>
      </View>

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="you@example.com"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={() => void submit()}
        returnKeyType="go"
      />

      {error !== null ? (
        <Text variant="caption" tone="danger" style={{ marginBottom: spacing.md }}>
          {error}
        </Text>
      ) : null}

      <Button title="Sign in" onPress={() => void submit()} loading={busy} />

      <View style={{ height: spacing.md }} />

      {isAppleAvailable ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={
            scheme === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={10}
          style={styles.apple}
          onPress={() => void withApple()}
        />
      ) : null}

      <View style={{ gap: spacing.sm, marginTop: spacing.xl, alignItems: 'center' }}>
        <Link href="/(auth)/forgot-password" asChild>
          <Text variant="label" tone="accent">
            Forgot your password?
          </Text>
        </Link>
        <Text
          variant="label"
          tone="accent"
          onPress={() => router.push('/(auth)/sign-up')}
          style={{ marginTop: spacing.sm }}
        >
          Create an account
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ apple: { height: 48, width: '100%' } });
