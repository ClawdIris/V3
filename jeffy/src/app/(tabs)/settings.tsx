import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { formatInviteCode, inviteShareMessage } from '@/domain/invite';
import { useProfile } from '@/features/profile/use-profile';
import {
  useCreateInvite,
  useInvites,
  useRevokeInvite,
  useSetStylistStatus,
  useStylists,
} from '@/features/stylist/use-invites';
import { LOCK_TIMEOUT_CHOICES } from '@/lib/lock-settings';
import { useAppLock } from '@/providers/app-lock-provider';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';

export default function SettingsScreen(): React.JSX.Element {
  const { activeCloset, memberships, setActiveCloset, signOut, user } = useAuth();
  const { profile } = useProfile();
  const lock = useAppLock();
  const router = useRouter();
  const { colors, radius, spacing } = useTheme();

  const closetId = activeCloset?.closetId ?? null;
  const isOwner = activeCloset?.role === 'owner';

  const { invites } = useInvites(isOwner ? closetId : null);
  const { createInvite, isCreating } = useCreateInvite(closetId);
  const { revoke } = useRevokeInvite(closetId);
  const { stylists } = useStylists(isOwner ? closetId : null);
  const { setStatus } = useSetStylistStatus(closetId);

  const [freshCode, setFreshCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mintInvite = async (): Promise<void> => {
    setError(null);
    try {
      const result = await createInvite();
      // Shown exactly once: the server keeps only the hash.
      setFreshCode(result.code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create an invite.');
    }
  };

  const shareCode = async (code: string): Promise<void> => {
    await Share.share({ message: inviteShareMessage(code, profile?.display_name ?? null) });
  };

  return (
    <Screen scroll>
      <Text variant="title" style={{ marginBottom: spacing.xl }}>
        Settings
      </Text>

      <Section title="You">
        <Row label="Name" value={profile?.display_name ?? '—'} />
        <Row label="Email" value={user?.email ?? '—'} />
        <Button
          title="Edit profile, sizes and budget"
          variant="secondary"
          onPress={() => router.push('/onboarding')}
        />
      </Section>

      {memberships.length > 1 ? (
        <Section title="Closets">
          {memberships.map((membership) => {
            const active = membership.closetId === activeCloset?.closetId;
            return (
              <Pressable
                key={membership.closetId}
                onPress={() => setActiveCloset(membership.closetId)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: active ? colors.surface : 'transparent',
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: active ? colors.border : 'transparent',
                  marginBottom: spacing.xs,
                }}
              >
                <Text variant="label">
                  {membership.role === 'owner'
                    ? 'My closet'
                    : `${membership.ownerName ?? 'Someone'}'s closet`}
                </Text>
                <Text variant="caption" tone="faint">
                  {membership.role === 'owner' ? 'Owner' : 'Stylist'}
                </Text>
              </Pressable>
            );
          })}
        </Section>
      ) : null}

      <Section title="Security">
        <View style={styles.switchRow}>
          <View style={{ flexShrink: 1, paddingRight: spacing.lg }}>
            <Text variant="label">Lock Jeffy</Text>
            <Text variant="caption" tone="faint">
              {lock.isSupported
                ? 'Face ID, Touch ID or your passcode on every cold launch.'
                : 'No biometrics or passcode set up on this device.'}
            </Text>
          </View>
          <Switch
            value={lock.isEnabled}
            disabled={!lock.isSupported}
            onValueChange={(next) => {
              if (next) void lock.enable();
              else void lock.disable();
            }}
          />
        </View>

        {lock.isEnabled ? (
          <View style={{ marginTop: spacing.md }}>
            <Text variant="label" tone="muted" style={{ marginBottom: spacing.sm }}>
              Lock after leaving the app
            </Text>
            <View style={[styles.chips, { gap: spacing.xs }]}>
              {LOCK_TIMEOUT_CHOICES.map((choice) => {
                const active = lock.timeoutSeconds === choice.seconds;
                return (
                  <Pressable
                    key={choice.seconds}
                    onPress={() => void lock.setTimeout(choice.seconds)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      borderRadius: radius.pill,
                      backgroundColor: active ? colors.text : colors.surface,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: colors.border,
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{ color: active ? colors.background : colors.textMuted }}
                    >
                      {choice.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Section>

      {isOwner ? (
        <Section title="Your stylist">
          {stylists.length === 0 ? (
            <Text variant="body" tone="muted" style={{ marginBottom: spacing.md }}>
              Nobody is styling your closet yet. Generate a code and send it to them.
            </Text>
          ) : (
            stylists.map((stylist) => (
              <View key={stylist.membershipId} style={styles.switchRow}>
                <View>
                  <Text variant="label">{stylist.displayName ?? 'Stylist'}</Text>
                  <Text variant="caption" tone="faint">
                    {stylist.status === 'accepted' ? 'Has access' : stylist.status}
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    void setStatus(
                      stylist.membershipId,
                      stylist.status === 'accepted' ? 'revoked' : 'accepted',
                    )
                  }
                  accessibilityRole="button"
                >
                  <Text variant="label" tone={stylist.status === 'accepted' ? 'danger' : 'accent'}>
                    {stylist.status === 'accepted' ? 'Revoke' : 'Restore'}
                  </Text>
                </Pressable>
              </View>
            ))
          )}

          {freshCode !== null ? (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: radius.md,
                padding: spacing.lg,
                marginVertical: spacing.md,
                gap: spacing.sm,
              }}
            >
              <Text variant="caption" tone="muted">
                Send this to your stylist. It works once, and you will not see it again.
              </Text>
              <Text variant="display" style={{ letterSpacing: 2 }}>
                {formatInviteCode(freshCode)}
              </Text>
              <Button title="Share" onPress={() => void shareCode(freshCode)} />
            </View>
          ) : null}

          <Button
            title="Generate an invite code"
            variant="secondary"
            loading={isCreating}
            onPress={() => void mintInvite()}
          />

          {invites.length > 0 ? (
            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <Text variant="label" tone="muted">
                Invites
              </Text>
              {invites.map((invite) => (
                <View key={invite.id} style={styles.switchRow}>
                  <View>
                    <Text variant="label">···{invite.codeHint}</Text>
                    <Text variant="caption" tone="faint">
                      {invite.state}
                    </Text>
                  </View>
                  {invite.state === 'pending' ? (
                    <Pressable
                      onPress={() => void revoke(invite.id)}
                      accessibilityRole="button"
                    >
                      <Text variant="label" tone="danger">
                        Cancel
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </Section>
      ) : null}

      <Section title="Style someone else">
        <Text variant="body" tone="muted" style={{ marginBottom: spacing.md }}>
          Got a code from a friend? Enter it to start styling their closet.
        </Text>
        <Button title="Enter an invite code" variant="secondary" onPress={() => router.push('/join')} />
      </Section>

      {error !== null ? (
        <Text variant="caption" tone="danger" style={{ marginBottom: spacing.md }}>
          {error}
        </Text>
      ) : null}

      <Button
        title="Sign out"
        variant="ghost"
        onPress={() => {
          void signOut();
        }}
      />
    </Screen>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { spacing } = useTheme();
  return (
    <View style={{ marginBottom: spacing.xxl }}>
      <Text variant="heading" style={{ marginBottom: spacing.md }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
        marginBottom: spacing.sm,
      }}
    >
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
});
