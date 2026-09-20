import type { Formality, ItemCategory, ItemRow, Season } from '@/types/database';

/**
 * The deterministic half of outfit generation.
 *
 * Claude never sees the closet. This module filters and scores it down to a
 * shortlist, the shortlist goes to the model as plain text fields, and
 * validateProposal() checks whatever comes back against that same shortlist.
 * Three things fall out of that:
 *
 *   1. "Only items actually in my closet" is structural, not a prompt request.
 *      A hallucinated id fails validation and never reaches the user.
 *   2. Every rule below is a pure function, so it is unit-testable without a
 *      network, a database or a model.
 *   3. A request costs a few hundred tokens instead of a whole wardrobe.
 */

// --- the subset of an item the engine reasons about -------------------------

export interface Candidate {
  readonly id: string;
  readonly name: string;
  readonly category: ItemCategory;
  readonly subcategory: string | null;
  readonly colors: readonly string[];
  readonly formality: Formality;
  readonly seasons: readonly Season[];
  readonly tags: readonly string[];
  readonly isFavorite: boolean;
  readonly isDirty: boolean;
  readonly isDonated: boolean;
  readonly lastWornAt: string | null;
  readonly wearCount: number;
}

export function toCandidate(item: ItemRow): Candidate {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    subcategory: item.subcategory,
    colors: item.colors,
    formality: item.formality,
    seasons: item.seasons,
    tags: item.tags,
    isFavorite: item.is_favorite,
    isDirty: item.is_dirty,
    isDonated: item.status === 'donated',
    lastWornAt: item.last_worn_at,
    wearCount: item.wear_count,
  };
}

// --- context ----------------------------------------------------------------

export interface OutfitContext {
  readonly date: Date;
  readonly season: Season;
  /** Null when weather is unavailable or the user overrode it. */
  readonly highC: number | null;
  readonly lowC: number | null;
  readonly precipitationChance: number | null;
  readonly occasion: string;
  readonly targetFormality: Formality;
  /** Items worn within this many days are held back. */
  readonly cooldownDays: number;
  /** Set when the user asks for a repeat anyway ("I don't care, use it"). */
  readonly ignoreCooldown: boolean;
}

export const DEFAULT_COOLDOWN_DAYS = 5;

/** Occasion → the formality the engine aims for. */
const OCCASION_FORMALITY: Readonly<Record<string, Formality>> = {
  gym: 1,
  errands: 2,
  travel: 2,
  'going out': 3,
  date: 3,
  'work business casual': 4,
  'wedding guest': 5,
};

export function formalityForOccasion(occasion: string): Formality {
  return OCCASION_FORMALITY[occasion.trim().toLowerCase()] ?? 3;
}

export function seasonForDate(date: Date): Season {
  // Northern hemisphere. A southern-hemisphere user would need this flipped
  // from their profile location; noted rather than guessed.
  const month = date.getMonth();
  if (month <= 1 || month === 11) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'fall';
}

// --- style rules ------------------------------------------------------------

export type Selector =
  | { readonly kind: 'item'; readonly itemId: string }
  | { readonly kind: 'category'; readonly category: ItemCategory }
  | { readonly kind: 'subcategory'; readonly subcategory: string }
  | { readonly kind: 'color'; readonly color: string }
  | { readonly kind: 'tag'; readonly tag: string };

export type MachineRule =
  | { readonly type: 'never_pair'; readonly a: Selector; readonly b: Selector }
  | { readonly type: 'always_pair'; readonly a: Selector; readonly b: Selector }
  | {
      readonly type: 'never_use';
      readonly target: Selector;
      readonly occasions?: readonly string[];
    };

export interface StyleRule {
  readonly id: string;
  readonly text: string;
  readonly strength: 'hard' | 'soft';
  readonly machine: MachineRule | null;
}

const eq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function matchesSelector(item: Candidate, selector: Selector): boolean {
  switch (selector.kind) {
    case 'item':
      return item.id === selector.itemId;
    case 'category':
      return item.category === selector.category;
    case 'subcategory':
      return item.subcategory !== null && eq(item.subcategory, selector.subcategory);
    case 'color':
      return item.colors.some((c) => eq(c, selector.color));
    case 'tag':
      return item.tags.some((t) => eq(t, selector.tag));
  }
}

export interface RuleViolation {
  readonly rule: StyleRule;
  readonly itemIds: readonly string[];
}

/**
 * Checks a complete outfit against the hard rules. Soft rules are left to the
 * model — they are the ones phrased as preferences rather than prohibitions.
 */
export function findHardViolations(
  items: readonly Candidate[],
  rules: readonly StyleRule[],
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    if (rule.strength !== 'hard' || rule.machine === null) continue;
    const machine = rule.machine;

    if (machine.type === 'never_pair') {
      for (const first of items) {
        if (!matchesSelector(first, machine.a)) continue;
        for (const second of items) {
          if (second.id === first.id) continue;
          if (matchesSelector(second, machine.b)) {
            violations.push({ rule, itemIds: [first.id, second.id] });
          }
        }
      }
    } else if (machine.type === 'always_pair') {
      const hasA = items.some((i) => matchesSelector(i, machine.a));
      const hasB = items.some((i) => matchesSelector(i, machine.b));
      if (hasA && !hasB) {
        violations.push({
          rule,
          itemIds: items.filter((i) => matchesSelector(i, machine.a)).map((i) => i.id),
        });
      }
    }
  }

  return violations;
}

// --- filtering --------------------------------------------------------------

export type ExclusionReason =
  | 'dirty'
  | 'donated'
  | 'out-of-season'
  | 'recently-worn'
  | 'formality-mismatch'
  | 'rule-excluded';

export interface Exclusion {
  readonly itemId: string;
  readonly reason: ExclusionReason;
}

export function daysSinceWorn(item: Candidate, now: Date): number | null {
  if (item.lastWornAt === null) return null;
  const worn = new Date(item.lastWornAt).getTime();
  if (Number.isNaN(worn)) return null;
  const MS_PER_DAY = 86_400_000;
  return Math.floor((now.getTime() - worn) / MS_PER_DAY);
}

/**
 * Formality tolerance. One step either way is fine — a 3 shirt works at a 4
 * occasion. Two steps is not: gym shorts are not wedding-guest trousers.
 */
const FORMALITY_TOLERANCE = 1;

export interface FilterResult {
  readonly eligible: readonly Candidate[];
  readonly excluded: readonly Exclusion[];
}

export function filterCandidates(
  items: readonly Candidate[],
  context: OutfitContext,
  rules: readonly StyleRule[],
): FilterResult {
  const eligible: Candidate[] = [];
  const excluded: Exclusion[] = [];

  const neverUse = rules.filter(
    (r): r is StyleRule & { machine: Extract<MachineRule, { type: 'never_use' }> } =>
      r.strength === 'hard' && r.machine !== null && r.machine.type === 'never_use',
  );

  for (const item of items) {
    if (item.isDonated) {
      excluded.push({ itemId: item.id, reason: 'donated' });
      continue;
    }
    if (item.isDirty) {
      excluded.push({ itemId: item.id, reason: 'dirty' });
      continue;
    }

    // An empty seasons array means "no opinion", so it survives every season
    // rather than being filtered out of existence.
    if (item.seasons.length > 0 && !item.seasons.includes(context.season)) {
      excluded.push({ itemId: item.id, reason: 'out-of-season' });
      continue;
    }

    if (Math.abs(item.formality - context.targetFormality) > FORMALITY_TOLERANCE) {
      excluded.push({ itemId: item.id, reason: 'formality-mismatch' });
      continue;
    }

    const blocked = neverUse.find((rule) => {
      if (!matchesSelector(item, rule.machine.target)) return false;
      const occasions = rule.machine.occasions;
      if (occasions === undefined || occasions.length === 0) return true;
      return occasions.some((o) => eq(o, context.occasion));
    });
    if (blocked !== undefined) {
      excluded.push({ itemId: item.id, reason: 'rule-excluded' });
      continue;
    }

    if (!context.ignoreCooldown) {
      const days = daysSinceWorn(item, context.date);
      if (days !== null && days < context.cooldownDays) {
        excluded.push({ itemId: item.id, reason: 'recently-worn' });
        continue;
      }
    }

    eligible.push(item);
  }

  return { eligible, excluded };
}

// --- scoring ----------------------------------------------------------------

/**
 * Weather bands, in °C, for the categories the forecast should push around.
 * Deliberately coarse: the forecast is a hint, not a specification.
 */
export const OUTERWEAR_MAX_C = 18;
export const OUTERWEAR_ESSENTIAL_C = 8;

export function scoreCandidate(item: Candidate, context: OutfitContext): number {
  let score = 0;

  // Exact season match beats a year-round item, which beats nothing.
  if (item.seasons.includes(context.season)) score += 2;
  else if (item.seasons.length === 0) score += 0.5;

  // Closer to the target formality is better.
  score += 2 - Math.abs(item.formality - context.targetFormality);

  if (item.isFavorite) score += 1.5;

  // Nudge toward things that never get worn — the whole point of the app is
  // to stop wearing the same three things.
  if (item.wearCount === 0) score += 1.5;
  else score += Math.max(0, 1 - item.wearCount / 20);

  const days = daysSinceWorn(item, context.date);
  if (days !== null) {
    // Ramps from 0 at the cooldown edge to +1 at three times the cooldown.
    const ramp = Math.min(1, days / Math.max(1, context.cooldownDays * 3));
    score += ramp;
  } else {
    score += 1;
  }

  if (item.category === 'outerwear' && context.highC !== null) {
    if (context.highC <= OUTERWEAR_ESSENTIAL_C) score += 2;
    else if (context.highC <= OUTERWEAR_MAX_C) score += 0.5;
    else score -= 3;
  }

  return score;
}

// --- shortlist --------------------------------------------------------------

export interface Shortlist {
  readonly byCategory: Readonly<Record<ItemCategory, readonly Candidate[]>>;
  readonly all: readonly Candidate[];
  readonly excluded: readonly Exclusion[];
}

export const DEFAULT_PER_CATEGORY = 6;

const EMPTY_BY_CATEGORY = (): Record<ItemCategory, Candidate[]> => ({
  top: [],
  bottom: [],
  outerwear: [],
  shoes: [],
  accessory: [],
});

export function buildShortlist(
  items: readonly Candidate[],
  context: OutfitContext,
  rules: readonly StyleRule[],
  perCategory: number = DEFAULT_PER_CATEGORY,
): Shortlist {
  const { eligible, excluded } = filterCandidates(items, context, rules);

  const buckets = EMPTY_BY_CATEGORY();
  for (const item of eligible) buckets[item.category].push(item);

  const byCategory = EMPTY_BY_CATEGORY();
  for (const category of Object.keys(buckets) as ItemCategory[]) {
    byCategory[category] = buckets[category]
      .map((item) => ({ item, score: scoreCandidate(item, context) }))
      // Ties broken by id so the shortlist is stable between identical calls.
      .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
      .slice(0, perCategory)
      .map((scored) => scored.item);
  }

  return {
    byCategory,
    all: Object.values(byCategory).flat(),
    excluded,
  };
}

// --- validating what the model sends back -----------------------------------

export interface ProposedOutfit {
  readonly itemIds: readonly string[];
  readonly reason: string;
}

export type RejectionReason =
  | 'unknown-item'
  | 'duplicate-item'
  | 'missing-core-piece'
  | 'hard-rule-violation'
  | 'empty';

export interface ValidationResult {
  readonly ok: boolean;
  readonly rejections: readonly RejectionReason[];
  readonly violations: readonly RuleViolation[];
  readonly items: readonly Candidate[];
}

/** An outfit is not an outfit without something on top and something below. */
const REQUIRED_SLOTS: readonly ItemCategory[] = ['top', 'bottom'];

export function validateProposal(
  proposal: ProposedOutfit,
  shortlist: Shortlist,
  rules: readonly StyleRule[],
): ValidationResult {
  const rejections: RejectionReason[] = [];
  const index = new Map(shortlist.all.map((item) => [item.id, item]));

  if (proposal.itemIds.length === 0) {
    return { ok: false, rejections: ['empty'], violations: [], items: [] };
  }

  const seen = new Set<string>();
  const items: Candidate[] = [];

  for (const id of proposal.itemIds) {
    if (seen.has(id)) {
      rejections.push('duplicate-item');
      continue;
    }
    seen.add(id);

    const item = index.get(id);
    // The anti-hallucination gate: an id the model invented, or one belonging
    // to an item that was filtered out, is not in the shortlist.
    if (item === undefined) {
      rejections.push('unknown-item');
      continue;
    }
    items.push(item);
  }

  for (const slot of REQUIRED_SLOTS) {
    if (!items.some((item) => item.category === slot)) {
      rejections.push('missing-core-piece');
    }
  }

  const violations = findHardViolations(items, rules);
  if (violations.length > 0) rejections.push('hard-rule-violation');

  return { ok: rejections.length === 0, rejections, violations, items };
}
