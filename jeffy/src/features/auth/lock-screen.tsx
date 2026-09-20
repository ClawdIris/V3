import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAppLock, type LockMethod } from '@/providers/app-lock-provider';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';

const METHOD_LABEL: Record<LockMethod, string> = {
  face: 'Face ID',
  fingerprint: 'Touch ID',
  iris: 'Iris',
  passcode: 'your passcode',
};

export function LockScreen(): React.JSX.Element {
  const { unlock, method } = useAppLock();
  const { signOut } = useAuth();
  const { colors, spacing } = useTheme();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const label = method === null ? 'your passcode' : METHOD_LABEL[method];

  const attempt = async (): Promise<void> => {
    setBusy(true);
    try {
      const ok = await unlock();
      setFailed(!ok);
    } finally {
      setBusy(false);
    }
  };

  // Prompt straight away, so the usual case is: open app, glance, in.
  useEffect(() => {
    void attempt();
    // Deliberately once per mount; retries are driven by the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, padding: spacing.xl }]}>
      <View style={{ gap: spacing.sm, alignItems: 'center' }}>
        <Text variant="display">Jeffy</Text>
        <Text variant="body" tone="muted" style={styles.centered}>
          {failed ? `Unlock with ${label} to continue.` : 'Locked'}
        </Text>
      </View>

      <View style={{ gap: spacing.md, alignSelf: 'stretch' }}>
        <Button title={`Unlock with ${label}`} onPress={attempt} loading={busy} />
        <Button
          title="Sign out"
          variant="ghost"
          onPress={() => {
            void signOut();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between', paddingVertical: 96 },
  centered: { textAlign: 'center' },
});
