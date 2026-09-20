import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { EMPTY_FILTERS, applyFilters, isFiltered, type ClosetFilters } from '@/features/closet/filters';
import { ItemTile } from '@/features/closet/item-tile';
import { useItems, useThumbnails } from '@/features/closet/use-items';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';
import { ITEM_CATEGORIES, type ItemCategory } from '@/types/database';

const COLUMNS = 3;

export default function ClosetScreen(): React.JSX.Element {
  const { activeCloset } = useAuth();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [filters, setFilters] = useState<ClosetFilters>(EMPTY_FILTERS);

  const { items, isLoading, isFetching, error, refetch } = useItems(
    activeCloset?.closetId ?? null,
  );

  const visible = useMemo(() => applyFilters(items, filters), [items, filters]);
  const { urls } = useThumbnails(useMemo(() => visible.map((i) => i.thumb_path), [visible]));

  const gutter = spacing.lg;
  const tileSize = (width - gutter * 2 - spacing.sm * (COLUMNS - 1)) / COLUMNS;

  const isStylist = activeCloset?.role === 'stylist';
  const title = isStylist
    ? `${activeCloset?.ownerName ?? 'Their'} closet`
    : 'Closet';

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={{ paddingHorizontal: gutter, paddingBottom: spacing.sm }}>
        <View style={styles.headerRow}>
          <Text variant="title">{title}</Text>
          {!isStylist ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add an item"
              onPress={() => router.push('/capture')}
              style={({ pressed }) => [
                styles.add,
                {
                  backgroundColor: colors.accent,
                  borderRadius: radius.pill,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text variant="heading" style={{ color: colors.onAccent, lineHeight: 26 }}>
                +
              </Text>
            </Pressable>
          ) : null}
        </View>

        <TextInput
          value={filters.query}
          onChangeText={(query) => setFilters((f) => ({ ...f, query }))}
          placeholder="Search your closet"
          placeholderTextColor={colors.textFaint}
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search your closet"
          style={[
            styles.search,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.md,
              color: colors.text,
              paddingHorizontal: spacing.md,
              marginTop: spacing.md,
            },
          ]}
        />

        <CategoryChips
          selected={filters.categories}
          onToggle={(category) =>
            setFilters((f) => ({
              ...f,
              categories: f.categories.includes(category)
                ? f.categories.filter((c) => c !== category)
                : [...f.categories, category],
            }))
          }
        />
      </View>

      {error !== null ? (
        <ErrorState message={error.message} onRetry={refetch} />
      ) : isLoading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          numColumns={COLUMNS}
          contentContainerStyle={{ padding: gutter, paddingTop: spacing.sm, gap: spacing.lg }}
          columnWrapperStyle={{ gap: spacing.sm }}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} />
          }
          renderItem={({ item }) => (
            <ItemTile
              item={item}
              url={item.thumb_path === null ? undefined : urls.get(item.thumb_path)}
              size={tileSize}
              onPress={() => router.push(`/item/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              filtered={isFiltered(filters)}
              isStylist={isStylist}
              onClear={() => setFilters(EMPTY_FILTERS)}
              onAdd={() => router.push('/capture')}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function CategoryChips({
  selected,
  onToggle,
}: {
  selected: readonly ItemCategory[];
  onToggle: (category: ItemCategory) => void;
}): React.JSX.Element {
  const { colors, radius, spacing } = useTheme();
  return (
    <View style={[styles.chips, { marginTop: spacing.md, gap: spacing.xs }]}>
      {ITEM_CATEGORIES.map((category) => {
        const active = selected.includes(category);
        return (
          <Pressable
            key={category}
            onPress={() => onToggle(category)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              paddingVertical: spacing.xs + 2,
              paddingHorizontal: spacing.md,
              borderRadius: radius.pill,
              backgroundColor: active ? colors.text : colors.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
            }}
          >
            <Text variant="caption" style={{ color: active ? colors.background : colors.textMuted }}>
              {category}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function EmptyState({
  filtered,
  isStylist,
  onClear,
  onAdd,
}: {
  filtered: boolean;
  isStylist: boolean;
  onClear: () => void;
  onAdd: () => void;
}): React.JSX.Element {
  const { spacing } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.md }}>
      <Text variant="heading">{filtered ? 'Nothing matches' : 'Nothing in here yet'}</Text>
      <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
        {filtered
          ? 'Try a different search or clear the filters.'
          : isStylist
            ? 'Once they photograph something, it shows up here.'
            : 'Photograph one thing to start. It takes about ten seconds.'}
      </Text>
      <View style={{ width: 220, marginTop: spacing.sm }}>
        {filtered ? (
          <Button title="Clear filters" variant="secondary" onPress={onClear} />
        ) : isStylist ? null : (
          <Button title="Add your first item" onPress={onAdd} />
        )}
      </View>
    </View>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.JSX.Element {
  const { spacing } = useTheme();
  return (
    <View style={[styles.centre, { padding: spacing.xl, gap: spacing.md }]}>
      <Text variant="heading">Could not load your closet</Text>
      <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
        {message}
      </Text>
      <View style={{ width: 220 }}>
        <Button title="Try again" onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  add: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  search: { borderWidth: StyleSheet.hairlineWidth, fontSize: 16, minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
});
