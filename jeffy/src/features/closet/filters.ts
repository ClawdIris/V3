import type { ItemCategory, Season } from '@/types/database';
import type { ItemWithPhoto } from './use-items';

/**
 * Closet filtering and search, kept pure so the grid stays instant and the
 * behaviour is testable without rendering anything.
 */

export interface ClosetFilters {
  readonly query: string;
  readonly categories: readonly ItemCategory[];
  readonly colors: readonly string[];
  readonly seasons: readonly Season[];
  readonly brands: readonly string[];
  readonly tags: readonly string[];
  readonly favoritesOnly: boolean;
  /** 'wearable' hides donated and laundry — the default view. */
  readonly shelf: 'wearable' | 'laundry' | 'donated' | 'all';
}

export const EMPTY_FILTERS: ClosetFilters = {
  query: '',
  categories: [],
  colors: [],
  seasons: [],
  brands: [],
  tags: [],
  favoritesOnly: false,
  shelf: 'wearable',
};

export function isFiltered(filters: ClosetFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.categories.length > 0 ||
    filters.colors.length > 0 ||
    filters.seasons.length > 0 ||
    filters.brands.length > 0 ||
    filters.tags.length > 0 ||
    filters.favoritesOnly ||
    filters.shelf !== 'wearable'
  );
}

const norm = (value: string): string => value.trim().toLowerCase();

function matchesQuery(item: ItemWithPhoto, query: string): boolean {
  const needle = norm(query);
  if (needle.length === 0) return true;
  const haystack = [
    item.name,
    item.brand ?? '',
    item.subcategory ?? '',
    item.material ?? '',
    item.pattern ?? '',
    item.notes ?? '',
    ...item.colors,
    ...item.tags,
  ]
    .join(' ')
    .toLowerCase();
  // Every word must appear somewhere, so "navy oxford" narrows rather than
  // widening the way an OR match would.
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

export function applyFilters(
  items: readonly ItemWithPhoto[],
  filters: ClosetFilters,
): ItemWithPhoto[] {
  return items.filter((item) => {
    switch (filters.shelf) {
      case 'wearable':
        if (item.status === 'donated' || item.is_dirty) return false;
        break;
      case 'laundry':
        if (!item.is_dirty || item.status === 'donated') return false;
        break;
      case 'donated':
        if (item.status !== 'donated') return false;
        break;
      case 'all':
        break;
    }

    if (filters.favoritesOnly && !item.is_favorite) return false;
    if (filters.categories.length > 0 && !filters.categories.includes(item.category)) return false;

    if (filters.seasons.length > 0) {
      // An item with no season set belongs to every season, so it survives a
      // season filter rather than vanishing.
      const matches =
        item.seasons.length === 0 || item.seasons.some((s) => filters.seasons.includes(s));
      if (!matches) return false;
    }

    if (filters.colors.length > 0) {
      const wanted = filters.colors.map(norm);
      if (!item.colors.some((c) => wanted.includes(norm(c)))) return false;
    }

    if (filters.brands.length > 0) {
      const brand = item.brand === null ? '' : norm(item.brand);
      if (!filters.brands.map(norm).includes(brand)) return false;
    }

    if (filters.tags.length > 0) {
      const wanted = filters.tags.map(norm);
      if (!item.tags.some((t) => wanted.includes(norm(t)))) return false;
    }

    return matchesQuery(item, filters.query);
  });
}

export interface FacetCounts {
  readonly categories: ReadonlyMap<ItemCategory, number>;
  readonly colors: ReadonlyMap<string, number>;
  readonly brands: ReadonlyMap<string, number>;
  readonly tags: ReadonlyMap<string, number>;
}

/** Drives the filter sheet: only offer a facet that would actually match. */
export function facetsOf(items: readonly ItemWithPhoto[]): FacetCounts {
  const categories = new Map<ItemCategory, number>();
  const colors = new Map<string, number>();
  const brands = new Map<string, number>();
  const tags = new Map<string, number>();

  const bump = <K,>(map: Map<K, number>, key: K): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const item of items) {
    if (item.status === 'donated') continue;
    bump(categories, item.category);
    for (const color of item.colors) bump(colors, norm(color));
    for (const tag of item.tags) bump(tags, norm(tag));
    if (item.brand !== null && item.brand.trim().length > 0) bump(brands, item.brand.trim());
  }

  return { categories, colors, brands, tags };
}
