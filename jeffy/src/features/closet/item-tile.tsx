import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/theme/use-theme';
import type { ItemWithPhoto } from './use-items';

export interface ItemTileProps {
  readonly item: ItemWithPhoto;
  readonly url: string | undefined;
  readonly size: number;
  readonly onPress: () => void;
}

export function ItemTile({ item, url, size, onPress }: ItemTileProps): React.JSX.Element {
  const { colors, radius, spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.name}
      style={({ pressed }) => [{ width: size, opacity: pressed ? 0.8 : 1 }]}
    >
      <View
        style={[
          styles.frame,
          {
            height: size * 1.25,
            backgroundColor: colors.placeholder,
            borderRadius: radius.md,
            borderColor: colors.border,
          },
        ]}
      >
        {url === undefined ? null : (
          <Image
            source={{ uri: url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            // expo-image keeps its own disk cache, which is what makes the
            // grid render offline after a first load.
            cachePolicy="disk"
            transition={120}
            accessible={false}
          />
        )}

        <View style={[styles.badges, { padding: spacing.xs, gap: spacing.xs }]}>
          {item.is_favorite ? <Badge label="♥" /> : null}
          {item.is_dirty ? <Badge label="Laundry" /> : null}
          {item.status === 'donated' ? <Badge label="Donated" /> : null}
        </View>
      </View>

      <Text variant="caption" numberOfLines={1} style={{ marginTop: spacing.xs }}>
        {item.name}
      </Text>
      {item.brand !== null ? (
        <Text variant="caption" tone="faint" numberOfLines={1}>
          {item.brand}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Badge({ label }: { label: string }): React.JSX.Element {
  const { radius } = useTheme();
  return (
    <View style={[styles.badge, { borderRadius: radius.pill }]}>
      <Text variant="caption" style={styles.badgeText}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  badges: { position: 'absolute', top: 0, right: 0, alignItems: 'flex-end' },
  badge: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#FFFFFF' },
});
