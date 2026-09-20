import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Text } from '@/components/ui/text';
import { formatCents, parsePriceToCents } from '@/domain/budget';
import { useTheme } from '@/theme/use-theme';
import type { TaggedItem } from '@/types/contracts';
import {
  ITEM_CATEGORIES,
  SEASONS,
  type Formality,
  type ItemCategory,
  type Json,
  type Season,
} from '@/types/database';

/**
 * The confirm-before-save form.
 *
 * Every field is editable no matter where the values came from, and the form
 * is identical whether the AI filled it or the user is typing from scratch —
 * which is what makes "AI got it wrong" a shrug rather than a dead end.
 */

export interface ItemDraft {
  name: string;
  category: ItemCategory;
  subcategory: string;
  colors: string[];
  pattern: string;
  material: string;
  formality: Formality;
  seasons: Season[];
  brand: string;
  size: string;
  priceInput: string;
  priceCents: number | null;
  notes: string;
  fromAi: boolean;
  aiConfidence: number | null;
  aiRaw: Json | null;
}

export const emptyDraft: ItemDraft = {
  name: '',
  category: 'top',
  subcategory: '',
  colors: [],
  pattern: '',
  material: '',
  formality: 3,
  seasons: [],
  brand: '',
  size: '',
  priceInput: '',
  priceCents: null,
  notes: '',
  fromAi: false,
  aiConfidence: null,
  aiRaw: null,
};

export function draftFromTags(tagged: TaggedItem): ItemDraft {
  return {
    ...emptyDraft,
    name: tagged.name,
    category: tagged.category,
    subcategory: tagged.subcategory ?? '',
    colors: tagged.colors,
    pattern: tagged.pattern ?? '',
    material: tagged.material ?? '',
    formality: clampFormality(tagged.formality),
    seasons: tagged.seasons,
    fromAi: true,
    aiConfidence: tagged.confidence,
    // Kept so a bad tag can be diagnosed after the user has corrected it.
    aiRaw: tagged as unknown as Json,
  };
}

function clampFormality(value: number): Formality {
  const rounded = Math.min(5, Math.max(1, Math.round(value)));
  return rounded as Formality;
}

const FORMALITY_LABELS: Record<Formality, string> = {
  1: 'Gym',
  2: 'Casual',
  3: 'Smart casual',
  4: 'Business casual',
  5: 'Formal',
};

export interface ItemFormProps {
  readonly draft: ItemDraft;
  readonly onChange: (next: ItemDraft) => void;
  readonly photoUri: string | null;
  readonly note: string | null;
  readonly error: string | null;
  readonly saving: boolean;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly saveLabel?: string;
}

export function ItemForm({
  draft,
  onChange,
  photoUri,
  note,
  error,
  saving,
  onSave,
  onCancel,
  saveLabel = 'Save to closet',
}: ItemFormProps): React.JSX.Element {
  const { colors, radius, spacing } = useTheme();
  const patch = (next: Partial<ItemDraft>): void => onChange({ ...draft, ...next });

  const nameMissing = draft.name.trim().length === 0;
  const priceInvalid =
    draft.priceInput.trim().length > 0 && parsePriceToCents(draft.priceInput) === null;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
      >
        {photoUri !== null ? (
          <Image
            source={{ uri: photoUri }}
            style={[styles.hero, { borderRadius: radius.lg }]}
            contentFit="cover"
            accessible={false}
          />
        ) : null}

        {note !== null ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              padding: spacing.md,
              marginBottom: spacing.lg,
            }}
          >
            <Text variant="caption" tone="muted">
              {note}
            </Text>
          </View>
        ) : null}

        <Field
          label="Name"
          value={draft.name}
          onChangeText={(name) => patch({ name })}
          placeholder="Navy oxford shirt"
          error={nameMissing ? 'Give it a name you will recognise.' : null}
        />

        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
          Category
        </Text>
        <ChipRow
          options={ITEM_CATEGORIES}
          selected={[draft.category]}
          onPress={(category) => patch({ category })}
        />

        <View style={{ height: spacing.lg }} />

        <Field
          label="Subcategory"
          value={draft.subcategory}
          onChangeText={(subcategory) => patch({ subcategory })}
          placeholder="Oxford, chino, chelsea boot…"
        />

        <Field
          label="Colours"
          value={draft.colors.join(', ')}
          onChangeText={(text) =>
            patch({
              colors: text
                .split(',')
                .map((c) => c.trim())
                .filter((c) => c.length > 0),
            })
          }
          placeholder="navy, white"
          hint="Comma separated. Used to match outfits."
          autoCapitalize="none"
        />

        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
          Formality — {FORMALITY_LABELS[draft.formality]}
        </Text>
        <ChipRow
          options={[1, 2, 3, 4, 5] as const}
          selected={[draft.formality]}
          labelFor={(value) => FORMALITY_LABELS[value]}
          onPress={(formality) => patch({ formality })}
        />

        <View style={{ height: spacing.lg }} />

        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
          Seasons
        </Text>
        <ChipRow
          options={SEASONS}
          selected={draft.seasons}
          onPress={(season) =>
            patch({
              seasons: draft.seasons.includes(season)
                ? draft.seasons.filter((s) => s !== season)
                : [...draft.seasons, season],
            })
          }
        />
        <Text variant="caption" tone="faint" style={{ marginTop: spacing.xs }}>
          Leave all off if it works year round.
        </Text>

        <View style={{ height: spacing.xl }} />

        <Field
          label="Brand (optional)"
          value={draft.brand}
          onChangeText={(brand) => patch({ brand })}
        />
        <Field
          label="Size (optional)"
          value={draft.size}
          onChangeText={(size) => patch({ size })}
          autoCapitalize="characters"
        />
        <Field
          label="What you paid (optional)"
          value={draft.priceInput}
          onChangeText={(priceInput) =>
            patch({ priceInput, priceCents: parsePriceToCents(priceInput) })
          }
          keyboardType="decimal-pad"
          placeholder="42.50"
          error={priceInvalid ? 'That does not look like a price.' : null}
          hint={
            draft.priceCents !== null
              ? `Cost per wear starts from ${formatCents(draft.priceCents)}.`
              : 'Lets Jeffy work out cost per wear.'
          }
        />
        <Field
          label="Material (optional)"
          value={draft.material}
          onChangeText={(material) => patch({ material })}
        />
        <Field
          label="Notes (optional)"
          value={draft.notes}
          onChangeText={(notes) => patch({ notes })}
          multiline
          style={{ minHeight: 88, paddingTop: 12 }}
        />

        {error !== null ? (
          <Text variant="caption" tone="danger" style={{ marginBottom: spacing.md }}>
            {error}
          </Text>
        ) : null}

        <Button
          title={saveLabel}
          onPress={onSave}
          loading={saving}
          disabled={nameMissing || priceInvalid}
        />
        <View style={{ height: spacing.sm }} />
        <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={saving} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ChipRow<T extends string | number>({
  options,
  selected,
  onPress,
  labelFor,
}: {
  options: readonly T[];
  selected: readonly T[];
  onPress: (value: T) => void;
  labelFor?: (value: T) => string;
}): React.JSX.Element {
  const { colors, radius, spacing } = useTheme();
  return (
    <View style={[styles.chips, { gap: spacing.xs }]}>
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <Pressable
            key={String(option)}
            onPress={() => onPress(option)}
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
              {labelFor === undefined ? String(option) : labelFor(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { width: '100%', height: 260, marginBottom: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
});
