import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { queryKeys } from '@/lib/query-client';
import { signedUrls } from '@/lib/images';
import { supabase } from '@/lib/supabase';
import type { ItemInsert, ItemRow, ItemUpdate } from '@/types/database';

export interface ItemWithPhoto extends ItemRow {
  readonly thumb_path: string | null;
  readonly photo_path: string | null;
}

interface ItemQueryRow extends ItemRow {
  item_photos: { storage_path: string; thumb_path: string; position: number }[] | null;
}

/**
 * The whole closet in one query.
 *
 * Deliberately not paginated. A large wardrobe is a few hundred rows of short
 * text, which is a single small response, and having all of it locally is what
 * makes filtering instant and the offline grid possible. Photos are the heavy
 * part, and those are fetched as thumbnails through signed URLs.
 */
export function useItems(closetId: string | null): {
  items: readonly ItemWithPhoto[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: queryKeys.items(closetId ?? 'none'),
    enabled: closetId !== null,
    queryFn: async (): Promise<ItemWithPhoto[]> => {
      if (closetId === null) return [];
      const { data, error } = await supabase
        .from('items')
        .select('*, item_photos ( storage_path, thumb_path, position )')
        .eq('closet_id', closetId)
        .order('created_at', { ascending: false });
      if (error !== null) throw error;

      return ((data ?? []) as ItemQueryRow[]).map((row) => {
        const photos = [...(row.item_photos ?? [])].sort((a, b) => a.position - b.position);
        const first = photos[0];
        const { item_photos: _photos, ...item } = row;
        return {
          ...item,
          thumb_path: first?.thumb_path ?? null,
          photo_path: first?.storage_path ?? null,
        };
      });
    },
  });

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * Signed thumbnail URLs for a grid, minted in one request rather than one per
 * tile. They expire, so this is keyed on the paths and refetched by the cache.
 */
export function useThumbnails(paths: readonly (string | null)[]): {
  urls: Map<string, string>;
  isLoading: boolean;
} {
  const present = useMemo(
    () => paths.filter((p): p is string => typeof p === 'string' && p.length > 0).sort(),
    [paths],
  );

  const query = useQuery({
    queryKey: ['thumbnails', present.join(',')],
    enabled: present.length > 0,
    // Comfortably inside the one-hour signature lifetime.
    staleTime: 45 * 60 * 1000,
    queryFn: () => signedUrls(present),
  });

  return { urls: query.data ?? new Map(), isLoading: query.isLoading };
}

export function useCreateItem(closetId: string | null): {
  create: (input: ItemInsert) => Promise<ItemRow>;
  isSaving: boolean;
  error: Error | null;
} {
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: ItemInsert): Promise<ItemRow> => {
      const { data, error } = await supabase.from('items').insert(input).select().single();
      if (error !== null) throw error;
      return data as ItemRow;
    },
    onSuccess: () => {
      if (closetId !== null) {
        void client.invalidateQueries({ queryKey: queryKeys.items(closetId) });
      }
    },
  });

  return {
    create: (input) => mutation.mutateAsync(input),
    isSaving: mutation.isPending,
    error: mutation.error,
  };
}

export function useUpdateItem(closetId: string | null): {
  update: (itemId: string, patch: ItemUpdate) => Promise<void>;
  isSaving: boolean;
  error: Error | null;
} {
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ itemId, patch }: { itemId: string; patch: ItemUpdate }) => {
      const { error } = await supabase.from('items').update(patch).eq('id', itemId);
      if (error !== null) throw error;
    },
    // Optimistic: toggling favourite or laundry should feel instant, and the
    // only failure mode is a permission error that a refetch corrects.
    onMutate: async ({ itemId, patch }) => {
      if (closetId === null) return { previous: undefined };
      const key = queryKeys.items(closetId);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ItemWithPhoto[]>(key);
      client.setQueryData<ItemWithPhoto[]>(key, (old) =>
        (old ?? []).map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (closetId !== null && context?.previous !== undefined) {
        client.setQueryData(queryKeys.items(closetId), context.previous);
      }
    },
    onSettled: () => {
      if (closetId !== null) {
        void client.invalidateQueries({ queryKey: queryKeys.items(closetId) });
      }
    },
  });

  return {
    update: async (itemId, patch) => {
      await mutation.mutateAsync({ itemId, patch });
    },
    isSaving: mutation.isPending,
    error: mutation.error,
  };
}
