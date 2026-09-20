import { EMPTY_FILTERS, applyFilters, facetsOf, isFiltered } from '../filters';
import type { ItemWithPhoto } from '../use-items';

function item(overrides: Partial<ItemWithPhoto> & Pick<ItemWithPhoto, 'id' | 'name'>): ItemWithPhoto {
  return {
    closet_id: 'c1',
    created_by: 'u1',
    category: 'top',
    subcategory: null,
    colors: [],
    pattern: null,
    material: null,
    formality: 3,
    seasons: [],
    brand: null,
    size: null,
    barcode: null,
    style_number: null,
    purchase_price_cents: null,
    tags: [],
    notes: null,
    is_favorite: false,
    is_dirty: false,
    status: 'active',
    last_worn_at: null,
    wear_count: 0,
    source: 'manual',
    ai_confidence: null,
    ai_raw: null,
    primary_photo_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    thumb_path: null,
    photo_path: null,
    ...overrides,
  };
}

const oxford = item({
  id: '1',
  name: 'Navy oxford shirt',
  brand: 'Uniqlo',
  colors: ['navy'],
  subcategory: 'Oxford',
  seasons: ['fall'],
  tags: ['work'],
});
const jeans = item({ id: '2', name: 'Black jeans', category: 'bottom', colors: ['black'] });
const dirtyTee = item({ id: '3', name: 'White tee', colors: ['white'], is_dirty: true });
const goneCoat = item({ id: '4', name: 'Old parka', category: 'outerwear', status: 'donated' });

const all = [oxford, jeans, dirtyTee, goneCoat];

describe('shelf', () => {
  it('hides laundry and donated by default', () => {
    expect(applyFilters(all, EMPTY_FILTERS).map((i) => i.id)).toEqual(['1', '2']);
  });

  it('shows only laundry on the laundry shelf', () => {
    const result = applyFilters(all, { ...EMPTY_FILTERS, shelf: 'laundry' });
    expect(result.map((i) => i.id)).toEqual(['3']);
  });

  it('shows only donated on the donated shelf', () => {
    const result = applyFilters(all, { ...EMPTY_FILTERS, shelf: 'donated' });
    expect(result.map((i) => i.id)).toEqual(['4']);
  });

  it('shows everything on the all shelf', () => {
    expect(applyFilters(all, { ...EMPTY_FILTERS, shelf: 'all' })).toHaveLength(4);
  });

  it('does not list a donated item as laundry even when it is dirty', () => {
    const dirtyAndGone = item({ id: '5', name: 'x', is_dirty: true, status: 'donated' });
    const result = applyFilters([dirtyAndGone], { ...EMPTY_FILTERS, shelf: 'laundry' });
    expect(result).toHaveLength(0);
  });
});

describe('search', () => {
  it('matches the name', () => {
    const result = applyFilters(all, { ...EMPTY_FILTERS, query: 'oxford' });
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('matches brand, colour, subcategory and tags', () => {
    for (const query of ['uniqlo', 'navy', 'work']) {
      expect(applyFilters(all, { ...EMPTY_FILTERS, query }).map((i) => i.id)).toEqual(['1']);
    }
  });

  it('is case insensitive', () => {
    expect(applyFilters(all, { ...EMPTY_FILTERS, query: 'NAVY OXFORD' })).toHaveLength(1);
  });

  it('narrows with each word rather than widening', () => {
    // An OR match would return both items here.
    expect(applyFilters(all, { ...EMPTY_FILTERS, query: 'navy jeans' })).toHaveLength(0);
  });

  it('ignores an empty or whitespace query', () => {
    expect(applyFilters(all, { ...EMPTY_FILTERS, query: '   ' })).toHaveLength(2);
  });
});

describe('facet filters', () => {
  it('filters by category', () => {
    const result = applyFilters(all, { ...EMPTY_FILTERS, categories: ['bottom'] });
    expect(result.map((i) => i.id)).toEqual(['2']);
  });

  it('filters by colour case-insensitively', () => {
    expect(applyFilters(all, { ...EMPTY_FILTERS, colors: ['NAVY'] }).map((i) => i.id)).toEqual([
      '1',
    ]);
  });

  it('keeps season-less items under a season filter', () => {
    // jeans has no seasons set, which means "any season", not "no season".
    const result = applyFilters(all, { ...EMPTY_FILTERS, seasons: ['summer'] });
    expect(result.map((i) => i.id)).toEqual(['2']);
  });

  it('filters by favourite', () => {
    const faves = [item({ id: '9', name: 'Fave', is_favorite: true }), jeans];
    expect(applyFilters(faves, { ...EMPTY_FILTERS, favoritesOnly: true })).toHaveLength(1);
  });

  it('combines filters conjunctively', () => {
    const result = applyFilters(all, {
      ...EMPTY_FILTERS,
      categories: ['top'],
      colors: ['black'],
    });
    expect(result).toHaveLength(0);
  });
});

describe('isFiltered', () => {
  it('is false for the default view', () => {
    expect(isFiltered(EMPTY_FILTERS)).toBe(false);
  });

  it('is true once anything is set', () => {
    expect(isFiltered({ ...EMPTY_FILTERS, query: 'x' })).toBe(true);
    expect(isFiltered({ ...EMPTY_FILTERS, shelf: 'all' })).toBe(true);
    expect(isFiltered({ ...EMPTY_FILTERS, favoritesOnly: true })).toBe(true);
  });
});

describe('facetsOf', () => {
  it('counts categories and colours, excluding donated items', () => {
    const facets = facetsOf(all);
    expect(facets.categories.get('top')).toBe(2);
    expect(facets.categories.get('outerwear')).toBeUndefined();
    expect(facets.colors.get('navy')).toBe(1);
  });

  it('ignores a blank brand', () => {
    const facets = facetsOf([item({ id: 'x', name: 'y', brand: '   ' })]);
    expect(facets.brands.size).toBe(0);
  });
});
