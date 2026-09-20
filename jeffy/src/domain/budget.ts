import type { BudgetRow, ItemCategory } from '@/types/database';

/**
 * Budget maths. Everything is in integer cents; no float ever touches money.
 */

export interface BudgetRange {
  readonly category: ItemCategory;
  readonly minCents: number;
  readonly maxCents: number;
}

export type BudgetVerdict = 'below' | 'within' | 'over' | 'unknown';

export interface BudgetCheck {
  readonly verdict: BudgetVerdict;
  /** Cents above maxCents. Zero unless the verdict is 'over'. */
  readonly overByCents: number;
  /** 0.25 means 25% over the top of the range. Zero unless 'over'. */
  readonly overByRatio: number;
  readonly range: BudgetRange | null;
}

export function toRange(row: BudgetRow): BudgetRange {
  return { category: row.category, minCents: row.min_cents, maxCents: row.max_cents };
}

export function rangeFor(
  ranges: readonly BudgetRange[],
  category: ItemCategory | null,
): BudgetRange | null {
  if (category === null) return null;
  return ranges.find((r) => r.category === category) ?? null;
}

/**
 * Feature 6 and 8f: compare a price to the comfortable range for its category.
 *
 * A price with no matching range is 'unknown', never 'over' — nagging about a
 * budget the user never set is how people turn the feature off.
 */
export function checkPrice(
  priceCents: number | null,
  category: ItemCategory | null,
  ranges: readonly BudgetRange[],
): BudgetCheck {
  const range = rangeFor(ranges, category);
  if (priceCents === null || range === null) {
    return { verdict: 'unknown', overByCents: 0, overByRatio: 0, range };
  }
  if (priceCents < range.minCents) {
    return { verdict: 'below', overByCents: 0, overByRatio: 0, range };
  }
  if (priceCents <= range.maxCents) {
    return { verdict: 'within', overByCents: 0, overByRatio: 0, range };
  }
  const overByCents = priceCents - range.maxCents;
  return {
    verdict: 'over',
    overByCents,
    // A range topping out at zero would divide by zero; treat any price above
    // it as wholly over rather than infinitely over.
    overByRatio: range.maxCents > 0 ? overByCents / range.maxCents : 1,
    range,
  };
}

export type SpendState = 'ok' | 'close' | 'over';

export interface SpendSummary {
  readonly totalCents: number;
  readonly budgetCents: number | null;
  readonly remainingCents: number | null;
  /** Fraction of the monthly budget used. Null when no budget is set. */
  readonly ratio: number | null;
  readonly state: SpendState;
}

/** At or above this fraction of the monthly budget, the UI warns. */
export const CLOSE_TO_BUDGET_RATIO = 0.8;

/**
 * Feature 6: wishlist total against the monthly clothing budget.
 * Items with no price contribute nothing rather than blocking the total.
 */
export function summariseSpend(
  priced: readonly (number | null)[],
  monthlyBudgetCents: number | null,
): SpendSummary {
  const totalCents = priced.reduce<number>((sum, cents) => sum + (cents ?? 0), 0);

  if (monthlyBudgetCents === null || monthlyBudgetCents <= 0) {
    return {
      totalCents,
      budgetCents: null,
      remainingCents: null,
      ratio: null,
      state: 'ok',
    };
  }

  const ratio = totalCents / monthlyBudgetCents;
  const state: SpendState = ratio > 1 ? 'over' : ratio >= CLOSE_TO_BUDGET_RATIO ? 'close' : 'ok';

  return {
    totalCents,
    budgetCents: monthlyBudgetCents,
    remainingCents: monthlyBudgetCents - totalCents,
    ratio,
    state,
  };
}

/**
 * Cost per wear, the only stat that reliably changes what someone buys.
 * Returns null when there is no price or the item has never been worn, rather
 * than a misleading Infinity.
 */
export function costPerWear(priceCents: number | null, wearCount: number): number | null {
  if (priceCents === null || priceCents < 0 || wearCount <= 0) return null;
  return Math.round(priceCents / wearCount);
}

// --- formatting -------------------------------------------------------------

export function formatCents(cents: number | null, currency = 'USD', locale = 'en-US'): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    // Whole-dollar prices read better without ".00" in a dense grid.
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatRange(range: BudgetRange | null, currency = 'USD'): string {
  if (range === null) return 'no range set';
  return `${formatCents(range.minCents, currency)}–${formatCents(range.maxCents, currency)}`;
}

/**
 * Parses free text from a price field: "$42", "42.50", "1,299.00", "  12 ".
 * Returns null for anything it cannot read, so the caller shows a field error
 * rather than silently saving a wrong number.
 */
export function parsePriceToCents(input: string): number | null {
  // Trim the ends, but do NOT strip interior whitespace: "4 2" is a typo, and
  // silently reading it as 42 writes a wrong price the user never sees.
  const cleaned = input.trim().replace(/[$,]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  // toFixed before parseInt: 42.1 * 100 is 4209.999... in binary floating point.
  return Number.parseInt((value * 100).toFixed(0), 10);
}
