import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { costPerWear, formatCents } from '@/domain/budget';
import { useItems, useThumbnails, useUpdateItem } from '@/features/closet/use-items';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';

export default function ItemScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { activeCloset } = useAuth();
  const { colors, radius, spacing } = useTheme();

  const { items, isLoading } = useItems(activeCloset?.closetId ?? null);
  const item = useMemo(() => items.find((candidate) => candidate.id === id) ?? null, [items, id]);
  const { urls } = useThumbnails(useMemo(() => [item?.photo_path ?? null], [item]));
  const { update } = useUpdateItem(activeCloset?.closetId ?? null);
  const [error, setError] = useState<string | null>(null);

  const isOwner = activeCloset?.role === 'owner';

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.fill, styles.centre, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.textMuted} />
      </SafeAreaView>
    );
  }

  if (item === null) {
    return (
      <SafeAreaView style={[styles.fill, styles.centre, { backgroundColor: colors.background }]}>
        <Text variant="heading">That item is gone</Text>
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const run = (patch: Parameters<typeof update>[1]): void => {
    setError(null);
    void update(item.id, patch).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not update that.');
    });
  };

  const cpw = costPerWear(item.purchase_price_cents, item.wear_count);
  const photoUrl = item.photo_path === null ? undefined : urls.get(item.photo_path);

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text variant="label" tone="accent">
            ← Closet
          </Text>
        </Pressable>

        <View
          style={[
            styles.hero,
            {
              backgroundColor: colors.placeholder,
              borderRadius: radius.lg,
              marginVertical: spacing.lg,
            },
          ]}
        >
          {photoUrl === undefined ? null : (
            <Image
              source={{ uri: photoUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="disk"
              accessible={false}
            />
          )}
        </View>

        <Text variant="title">{item.name}</Text>
        <Text variant="body" tone="muted" style={{ marginTop: spacing.xs }}>
          {[item.brand, item.subcategory ?? item.category].filter(Boolean).join(' · ')}
        </Text>

        <View style={{ height: spacing.xl }} />

        <Detail label="Colours" value={item.colors.join(', ') || '—'} />
        <Detail label="Seasons" value={item.seasons.join(', ') || 'Year round'} />
        <Detail label="Material" value={item.material ?? '—'} />
        <Detail label="Size" value={item.size ?? '—'} />
        <Detail label="Paid" value={formatCents(item.purchase_price_cents)} />
        <Detail label="Worn" value={item.wear_count === 0 ? 'Never' : `${item.wear_count}×`} />
        <Detail
          label="Cost per wear"
          value={
            cpw === null
              ? item.purchase_price_cents === null
                ? 'Add a price to see this'
                : 'Not worn yet'
              : formatCents(cpw)
          }
        />
        {item.notes !== null ? <Detail label="Notes" value={item.notes} /> : null}

        {error !== null ? (
          <Text variant="caption" tone="danger" style={{ marginTop: spacing.md }}>
            {error}
          </Text>
        ) : null}

        {isOwner ? (
          <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
            <Button
              title={item.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
              variant="secondary"
              onPress={() => run({ is_favorite: !item.is_favorite })}
            />
            <Button
              title={item.is_dirty ? 'Back from the laundry' : 'In the laundry'}
              variant="secondary"
              onPress={() => run({ is_dirty: !item.is_dirty })}
            />
            <Button
              title={item.status === 'donated' ? 'Back in the closet' : 'Mark as donated'}
              variant="ghost"
              onPress={() => run({ status: item.status === 'donated' ? 'active' : 'donated' })}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
        gap: spacing.lg,
      }}
    >
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="label" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  hero: { width: '100%', height: 360, overflow: 'hidden' },
});
