import {
  CLOSE_TO_BUDGET_RATIO,
  checkPrice,
  costPerWear,
  formatCents,
  formatRange,
  parsePriceToCents,
  summariseSpend,
  type BudgetRange,
} from '../budget';

const topRange: BudgetRange = { category: 'top', minCents: 2000, maxCents: 8000 };
const shoeRange: BudgetRange = { category: 'shoes', minCents: 6000, maxCents: 20000 };
const ranges: BudgetRange[] = [topRange, shoeRange];

describe('checkPrice', () => {
  it('reports a price inside the range as within', () => {
    expect(checkPrice(5000, 'top', ranges).verdict).toBe('within');
  });

  it('treats the range bounds as inclusive', () => {
    expect(checkPrice(2000, 'top', ranges).verdict).toBe('within');
    expect(checkPrice(8000, 'top', ranges).verdict).toBe('within');
  });

  it('reports a bargain as below rather than a problem', () => {
    expect(checkPrice(1000, 'top', ranges).verdict).toBe('below');
  });

  it('quantifies how far over the range a price is', () => {
    const check = checkPrice(12000, 'top', ranges);
    expect(check.verdict).toBe('over');
    expect(check.overByCents).toBe(4000);
    expect(check.overByRatio).toBeCloseTo(0.5);
  });

  it('is unknown, never over, when no range is set for the category', () => {
    expect(checkPrice(999999, 'outerwear', ranges).verdict).toBe('unknown');
  });

  it('is unknown when the price is unknown', () => {
    expect(checkPrice(null, 'top', ranges).verdict).toBe('unknown');
  });

  it('does not divide by zero on a zero-max range', () => {
    const check = checkPrice(500, 'top', [{ category: 'top', minCents: 0, maxCents: 0 }]);
    expect(check.verdict).toBe('over');
    expect(Number.isFinite(check.overByRatio)).toBe(true);
    expect(check.overByRatio).toBe(1);
  });
});

describe('summariseSpend', () => {
  it('sums prices and ignores unpriced entries', () => {
    expect(summariseSpend([1000, null, 2500], null).totalCents).toBe(3500);
  });

  it('reports ok well under budget', () => {
    expect(summariseSpend([1000], 20000).state).toBe('ok');
  });

  it('warns at the close-to-budget threshold', () => {
    const summary = summariseSpend([CLOSE_TO_BUDGET_RATIO * 20000], 20000);
    expect(summary.state).toBe('close');
  });

  it('reports over once the total exceeds the budget', () => {
    const summary = summariseSpend([25000], 20000);
    expect(summary.state).toBe('over');
    expect(summary.remainingCents).toBe(-5000);
  });

  it('stays ok and reports no ratio when no budget is set', () => {
    const summary = summariseSpend([99999], null);
    expect(summary.state).toBe('ok');
    expect(summary.ratio).toBeNull();
    expect(summary.remainingCents).toBeNull();
  });

  it('treats a zero budget as unset rather than instantly over', () => {
    expect(summariseSpend([100], 0).state).toBe('ok');
  });
});

describe('costPerWear', () => {
  it('divides price by wears', () => {
    expect(costPerWear(10000, 4)).toBe(2500);
  });

  it('rounds to whole cents', () => {
    expect(costPerWear(10000, 3)).toBe(3333);
  });

  it('returns null rather than Infinity for a never-worn item', () => {
    expect(costPerWear(10000, 0)).toBeNull();
  });

  it('returns null when there is no price', () => {
    expect(costPerWear(null, 5)).toBeNull();
  });
});

describe('parsePriceToCents', () => {
  it.each([
    ['42', 4200],
    ['42.50', 4250],
    ['$42.50', 4250],
    ['1,299.00', 129900],
    ['  12 ', 1200],
    ['0', 0],
    ['0.05', 5],
  ])('parses %s', (input, expected) => {
    expect(parsePriceToCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '42.505', '4 2', '-5', '.', '1.2.3'])('rejects %s', (input) => {
    expect(parsePriceToCents(input)).toBeNull();
  });

  it('does not lose a cent to floating point', () => {
    // 42.1 * 100 is 4209.999999999999 in IEEE 754.
    expect(parsePriceToCents('42.10')).toBe(4210);
    expect(parsePriceToCents('1.15')).toBe(115);
    expect(parsePriceToCents('8.29')).toBe(829);
  });
});

describe('formatting', () => {
  it('drops the decimals on whole dollars', () => {
    expect(formatCents(4200)).toBe('$42');
  });

  it('keeps the decimals otherwise', () => {
    expect(formatCents(4250)).toBe('$42.50');
  });

  it('renders an unknown price as a dash', () => {
    expect(formatCents(null)).toBe('—');
  });

  it('describes a missing range in words', () => {
    expect(formatRange(null)).toBe('no range set');
  });

  it('renders a range', () => {
    expect(formatRange(topRange)).toBe('$20–$80');
  });
});
