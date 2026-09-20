import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { ItemForm, type ItemDraft, emptyDraft, draftFromTags } from '@/features/closet/item-form';
import { useCreateItem } from '@/features/closet/use-items';
import { useTagItem } from '@/features/closet/use-tag-item';
import { describeAiError } from '@/lib/ai-client';
import { processPhoto, uploadImagePair } from '@/lib/images';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/theme/use-theme';

type Stage = 'camera' | 'analysing' | 'review' | 'saving';

export default function CaptureScreen(): React.JSX.Element {
  const router = useRouter();
  const { activeCloset, user } = useAuth();
  const { colors, spacing } = useTheme();

  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const [stage, setStage] = useState<Stage>('camera');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { tag } = useTagItem();
  const { create } = useCreateItem(activeCloset?.closetId ?? null);

  if (activeCloset === null || activeCloset.role !== 'owner') {
    return (
      <Screen>
        <View style={styles.centre}>
          <Text variant="heading">Only the closet owner can add items</Text>
          <Button title="Close" variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const analyse = async (uri: string): Promise<void> => {
    setPhotoUri(uri);
    setStage('analysing');
    setAiNote(null);
    try {
      const tagged = await tag(uri, activeCloset.closetId);
      setDraft(draftFromTags(tagged));
      setAiNote(
        tagged.confidence < 0.6
          ? 'Not very sure about this one — worth a look before you save.'
          : tagged.notes,
      );
    } catch (cause) {
      // The manual fallback IS the product here: the form opens either way,
      // just empty, with an explanation rather than a dead end.
      setDraft(emptyDraft);
      setAiNote(describeAiError(cause));
    } finally {
      setStage('review');
    }
  };

  const capture = async (): Promise<void> => {
    const photo = await camera.current?.takePictureAsync({ quality: 1, skipProcessing: false });
    if (photo?.uri === undefined) return;
    await analyse(photo.uri);
  };

  const pickFromLibrary = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: false,
    });
    const asset = result.assets?.[0];
    if (result.canceled || asset === undefined) return;
    await analyse(asset.uri);
  };

  const save = async (): Promise<void> => {
    if (photoUri === null || user === null) return;
    setSaveError(null);
    setStage('saving');

    try {
      const pair = await processPhoto(photoUri);
      const uploaded = await uploadImagePair(pair, activeCloset.closetId, 'items', user.id);

      const item = await create({
        closet_id: activeCloset.closetId,
        created_by: user.id,
        name: draft.name.trim(),
        category: draft.category,
        subcategory: draft.subcategory.trim() === '' ? null : draft.subcategory.trim(),
        colors: draft.colors,
        pattern: draft.pattern.trim() === '' ? null : draft.pattern.trim(),
        material: draft.material.trim() === '' ? null : draft.material.trim(),
        formality: draft.formality,
        seasons: draft.seasons,
        brand: draft.brand.trim() === '' ? null : draft.brand.trim(),
        size: draft.size.trim() === '' ? null : draft.size.trim(),
        purchase_price_cents: draft.priceCents,
        notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
        source: draft.fromAi ? 'ai_single' : 'manual',
        ai_confidence: draft.aiConfidence,
        ai_raw: draft.aiRaw,
      });

      const { data: photo, error } = await supabase
        .from('item_photos')
        .insert({
          item_id: item.id,
          closet_id: activeCloset.closetId,
          storage_path: uploaded.storagePath,
          thumb_path: uploaded.thumbPath,
          width: uploaded.width,
          height: uploaded.height,
          position: 0,
        })
        .select('id')
        .single();
      if (error !== null) throw error;

      await supabase.from('items').update({ primary_photo_id: photo.id }).eq('id', item.id);

      router.back();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save that item.');
      setStage('review');
    }
  };

  if (stage === 'camera') {
    if (permission === null) {
      return (
        <Screen>
          <View style={styles.centre}>
            <ActivityIndicator color={colors.textMuted} />
          </View>
        </Screen>
      );
    }

    if (!permission.granted) {
      return (
        <Screen>
          <View style={[styles.centre, { gap: spacing.md, padding: spacing.xl }]}>
            <Text variant="heading">Jeffy needs the camera</Text>
            <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
              To photograph a piece so it can be catalogued. You can also pick an existing photo.
            </Text>
            <View style={{ alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md }}>
              <Button title="Allow camera" onPress={() => void requestPermission()} />
              <Button
                title="Choose a photo instead"
                variant="secondary"
                onPress={() => void pickFromLibrary()}
              />
              <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
            </View>
          </View>
        </Screen>
      );
    }

    return (
      <View style={styles.fill}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
        <SafeAreaView style={styles.cameraOverlay} edges={['top', 'bottom']}>
          <View style={[styles.cameraTop, { padding: spacing.lg }]}>
            <Pressable onPress={() => router.back()} accessibilityRole="button">
              <Text variant="label" style={styles.onCamera}>
                Cancel
              </Text>
            </Pressable>
            <Text variant="label" style={styles.onCamera}>
              One piece, plain background
            </Text>
          </View>

          <View style={[styles.cameraBottom, { padding: spacing.xl }]}>
            <Pressable
              onPress={() => void pickFromLibrary()}
              accessibilityRole="button"
              accessibilityLabel="Choose from library"
            >
              <Text variant="label" style={styles.onCamera}>
                Library
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void capture()}
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              style={({ pressed }) => [styles.shutter, { opacity: pressed ? 0.7 : 1 }]}
            />

            <View style={styles.shutterSpacer} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (stage === 'analysing') {
    return (
      <Screen>
        <View style={[styles.centre, { gap: spacing.lg }]}>
          {photoUri !== null ? (
            <Image
              source={{ uri: photoUri }}
              style={styles.preview}
              contentFit="cover"
              accessible={false}
            />
          ) : null}
          <ActivityIndicator color={colors.textMuted} />
          <Text variant="body" tone="muted">
            Working out what this is…
          </Text>
          <Button
            title="Skip and fill it in myself"
            variant="ghost"
            onPress={() => {
              setDraft(emptyDraft);
              setAiNote(null);
              setStage('review');
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <ItemForm
      draft={draft}
      onChange={setDraft}
      photoUri={photoUri}
      note={aiNote}
      error={saveError}
      saving={stage === 'saving'}
      onSave={() => void save()}
      onCancel={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000000' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraOverlay: { flex: 1, justifyContent: 'space-between' },
  cameraTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cameraBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  onCamera: { color: '#FFFFFF' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  shutterSpacer: { width: 52 },
  preview: { width: 180, height: 225, borderRadius: 12 },
});
