import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  describeRedeemStatus,
  formatInviteCode,
  isWellFormedInviteCode,
  normaliseInviteCode,
} from '@/domain/invite';
import { useRedeemInvite } from '@/features/stylist/use-invites';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';

export default function JoinScreen(): React.JSX.Element {
  const router = useRouter();
  const { redeem, isRedeeming } = useRedeemInvite();
  const { refreshMemberships, setActiveCloset } = useAuth();
  const { spacing } = useTheme();

  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const wellFormed = isWellFormedInviteCode(code);

  const submit = async (): Promise<void> => {
    setMessage(null);
    try {
      const result = await redeem(normaliseInviteCode(code));
      const outcome = describeRedeemStatus(result.status, result.owner_name);
      setMessage(outcome.message);
      setOk(outcome.ok);

      if (outcome.ok) {
        await refreshMemberships();
        if (result.closet_id !== null) setActiveCloset(result.closet_id);
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Could not check that code.');
      setOk(false);
    }
  };

  return (
    <Screen scroll>
      <Text variant="title" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
        Enter your invite code
      </Text>
      <Text variant="body" tone="muted" style={{ marginBottom: spacing.xl }}>
        The eight characters your friend sent you. Dashes and capitals do not matter.
      </Text>

      <Field
        label="Code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD-EFGH"
        maxLength={12}
        style={{ fontSize: 22, letterSpacing: 2 }}
        hint={
          code.length > 0 && !wellFormed
            ? 'Eight letters and numbers — no I, O, 0 or 1.'
            : wellFormed
              ? formatInviteCode(code)
              : undefined
        }
      />

      {message !== null ? (
        <Text
          variant="body"
          tone={ok ? 'success' : 'danger'}
          style={{ marginBottom: spacing.lg }}
        >
          {message}
        </Text>
      ) : null}

      {ok ? (
        <Button title="Open their closet" onPress={() => router.replace('/(tabs)')} />
      ) : (
        <Button
          title="Join"
          onPress={() => void submit()}
          loading={isRedeeming}
          disabled={!wellFormed}
        />
      )}

      <View style={{ height: spacing.sm }} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
