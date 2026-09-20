import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

/**
 * Query cache with on-disk persistence.
 *
 * Quality bar 3: browsing the closet works offline. The cache is rehydrated
 * from AsyncStorage at launch, so the grid and item detail render from the
 * last sync with no network. Thumbnails are cached separately on the
 * filesystem (see lib/image-cache.ts) because they are far too big for this.
 *
 * Nothing sensitive goes in here: the auth session lives in the keychain, and
 * the cache holds only closet data the user can already see.
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Closet data changes when the user changes it, so refetching on every
      // focus is wasted battery. Realtime pushes the things that do change
      // underneath us (chat, stylist outfits).
      staleTime: 5 * 60 * 1000,
      gcTime: 7 * 24 * 60 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
      // Offline: serve the persisted cache rather than sitting in a
      // permanent pending state with nothing on screen.
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
      networkMode: 'offlineFirst',
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'jeffy.query-cache',
  throttleTime: 2_000,
});

export const queryKeys = {
  profile: (userId: string) => ['profile', userId] as const,
  budgets: (userId: string) => ['budgets', userId] as const,
  items: (closetId: string) => ['items', closetId] as const,
  item: (itemId: string) => ['item', itemId] as const,
  invites: (closetId: string) => ['invites', closetId] as const,
  members: (closetId: string) => ['members', closetId] as const,
  styleRules: (closetId: string) => ['style-rules', closetId] as const,
  signedUrl: (path: string) => ['signed-url', path] as const,
} as const;
