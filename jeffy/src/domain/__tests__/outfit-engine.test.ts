import {
  DEFAULT_COOLDOWN_DAYS,
  buildShortlist,
  daysSinceWorn,
  filterCandidates,
  findHardViolations,
  formalityForOccasion,
  matchesSelector,
  scoreCandidate,
  seasonForDate,
  validateProposal,
  type Candidate,
  type OutfitContext,
  type StyleRule,
} from '../outfit-engine';

const NOW = new Date('2026-11-10T09:00:00Z'); // a Tuesday in fall

function item(overrides: Partial<Candidate> & Pick<Candidate, 'id'>): Candidate {
  return {
    name: `Item ${overrides.id}`,
    category: 'top',
    subcategory: null,
    colors: [],
    formality: 3,
    seasons: [],
    tags: [],
    isFavorite: false,
    isDirty: false,
    isDonated: false,
    lastWornAt: null,
    wearCount: 0,
    ...overrides,
  };
}

function context(overrides: Partial<OutfitContext> = {}): OutfitContext {
  return {
    date: NOW,
    season: 'fall',
    highC: 16,
    lowC: 8,
    precipitationChance: 0.1,
    occasion: 'work business casual',
    targetFormality: 4,
    cooldownDays: DEFAULT_COOLDOWN_DAYS,
    ignoreCooldown: false,
    ...overrides,
  };
}

describe('seasonForDate', () => {
  it.each([
    ['2026-01-15', 'winter'],
    ['2026-03-15', 'spring'],
    ['2026-07-15', 'summer'],
    ['2026-10-15', 'fall'],
    ['2026-12-15', 'winter'],
  ])('maps %s to %s', (iso, expected) => {
    expect(seasonForDate(new Date(`${iso}T12:00:00Z`))).toBe(expected);
  });
});

describe('formalityForOccasion', () => {
  it('maps known occasions', () => {
    expect(formalityForOccasion('gym')).toBe(1);
    expect(formalityForOccasion('wedding guest')).toBe(5);
    expect(formalityForOccasion('Work Business Casual')).toBe(4);
  });

  it('falls back to the middle for free-text occasions', () => {
    expect(formalityForOccasion('drinks with my weird uncle')).toBe(3);
  });
});

describe('filterCandidates', () => {
  it('excludes items in the laundry', () => {
    const result = filterCandidates([item({ id: 'a', isDirty: true })], context(), []);
    expect(result.eligible).toHaveLength(0);
    expect(result.excluded[0]).toEqual({ itemId: 'a', reason: 'dirty' });
  });

  it('excludes donated items', () => {
    const result = filterCandidates([item({ id: 'a', isDonated: true })], context(), []);
    expect(result.excluded[0]?.reason).toBe('donated');
  });

  it('excludes items tagged for another season', () => {
    const result = filterCandidates([item({ id: 'a', seasons: ['summer'] })], context(), []);
    expect(result.excluded[0]?.reason).toBe('out-of-season');
  });

  it('keeps items with no season opinion in every season', () => {
    const result = filterCandidates([item({ id: 'a', seasons: [] })], context(), []);
    expect(result.eligible).toHaveLength(1);
  });

  it('allows one step of formality either way', () => {
    const items = [item({ id: 'a', formality: 3 }), item({ id: 'b', formality: 5 })];
    const result = filterCandidates(items, context({ targetFormality: 4 }), []);
    expect(result.eligible.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('rejects two steps of formality', () => {
    const result = filterCandidates(
      [item({ id: 'gym-shorts', formality: 1 })],
      context({ targetFormality: 4 }),
      [],
    );
    expect(result.excluded[0]?.reason).toBe('formality-mismatch');
  });

  describe('recent-wear cooldown', () => {
    it('holds back something worn yesterday', () => {
      const yesterday = new Date(NOW.getTime() - 86_400_000).toISOString();
      const result = filterCandidates([item({ id: 'a', lastWornAt: yesterday })], context(), []);
      expect(result.excluded[0]?.reason).toBe('recently-worn');
    });

    it('releases it once the cooldown has passed', () => {
      const longAgo = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
      const result = filterCandidates([item({ id: 'a', lastWornAt: longAgo })], context(), []);
      expect(result.eligible).toHaveLength(1);
    });

    it('treats the cooldown boundary as available', () => {
      const exactly = new Date(NOW.getTime() - DEFAULT_COOLDOWN_DAYS * 86_400_000).toISOString();
      const result = filterCandidates([item({ id: 'a', lastWornAt: exactly })], context(), []);
      expect(result.eligible).toHaveLength(1);
    });

    it('is skipped when the user asks for a repeat', () => {
      const yesterday = new Date(NOW.getTime() - 86_400_000).toISOString();
      const result = filterCandidates(
        [item({ id: 'a', lastWornAt: yesterday })],
        context({ ignoreCooldown: true }),
        [],
      );
      expect(result.eligible).toHaveLength(1);
    });
  });

  it('honours a never_use hard rule', () => {
    const rules: StyleRule[] = [
      {
        id: 'r1',
        text: 'Never the novelty tie',
        strength: 'hard',
        machine: { type: 'never_use', target: { kind: 'tag', tag: 'novelty' } },
      },
    ];
    const result = filterCandidates([item({ id: 'a', tags: ['novelty'] })], context(), rules);
    expect(result.excluded[0]?.reason).toBe('rule-excluded');
  });

  it('scopes an occasion-limited never_use rule to that occasion', () => {
    const rules: StyleRule[] = [
      {
        id: 'r1',
        text: 'No shorts at work',
        strength: 'hard',
        machine: {
          type: 'never_use',
          target: { kind: 'subcategory', subcategory: 'shorts' },
          occasions: ['work business casual'],
        },
      },
    ];
    const shorts = item({ id: 'a', subcategory: 'shorts', category: 'bottom', formality: 3 });

    expect(filterCandidates([shorts], context(), rules).eligible).toHaveLength(0);
    expect(
      filterCandidates([shorts], context({ occasion: 'errands', targetFormality: 2 }), rules)
        .eligible,
    ).toHaveLength(1);
  });

  it('ignores soft rules when filtering — those are the model’s job', () => {
    const rules: StyleRule[] = [
      {
        id: 'r1',
        text: 'Prefer not to use the novelty tie',
        strength: 'soft',
        machine: { type: 'never_use', target: { kind: 'tag', tag: 'novelty' } },
      },
    ];
    expect(filterCandidates([item({ id: 'a', tags: ['novelty'] })], context(), rules).eligible)
      .toHaveLength(1);
  });
});

describe('matchesSelector', () => {
  const subject = item({
    id: 'x',
    subcategory: 'Oxford',
    colors: ['Navy', 'white'],
    tags: ['work'],
    category: 'top',
  });

  it('matches on id, category, subcategory, colour and tag', () => {
    expect(matchesSelector(subject, { kind: 'item', itemId: 'x' })).toBe(true);
    expect(matchesSelector(subject, { kind: 'category', category: 'top' })).toBe(true);
    expect(matchesSelector(subject, { kind: 'subcategory', subcategory: 'oxford' })).toBe(true);
    expect(matchesSelector(subject, { kind: 'color', color: 'navy' })).toBe(true);
    expect(matchesSelector(subject, { kind: 'tag', tag: 'WORK' })).toBe(true);
  });

  it('is case and whitespace insensitive, because humans type the rules', () => {
    expect(matchesSelector(subject, { kind: 'color', color: '  NAVY ' })).toBe(true);
  });

  it('does not match what it should not', () => {
    expect(matchesSelector(subject, { kind: 'color', color: 'brown' })).toBe(false);
    expect(matchesSelector(subject, { kind: 'category', category: 'shoes' })).toBe(false);
  });
});

describe('findHardViolations', () => {
  const noBrownWithBlack: StyleRule = {
    id: 'r1',
    text: 'No brown belt with black shoes',
    strength: 'hard',
    machine: {
      type: 'never_pair',
      a: { kind: 'color', color: 'brown' },
      b: { kind: 'color', color: 'black' },
    },
  };

  it('catches a forbidden pairing', () => {
    const outfit = [
      item({ id: 'belt', category: 'accessory', colors: ['brown'] }),
      item({ id: 'shoes', category: 'shoes', colors: ['black'] }),
    ];
    const violations = findHardViolations(outfit, [noBrownWithBlack]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.itemIds).toEqual(['belt', 'shoes']);
  });

  it('passes an outfit that breaks no rule', () => {
    const outfit = [
      item({ id: 'belt', category: 'accessory', colors: ['black'] }),
      item({ id: 'shoes', category: 'shoes', colors: ['black'] }),
    ];
    expect(findHardViolations(outfit, [noBrownWithBlack])).toHaveLength(0);
  });

  it('never flags a single item against itself', () => {
    const outfit = [item({ id: 'both', colors: ['brown', 'black'] })];
    expect(findHardViolations(outfit, [noBrownWithBlack])).toHaveLength(0);
  });

  it('enforces always_pair', () => {
    const rule: StyleRule = {
      id: 'r2',
      text: 'Always cuff jeans with the white sneakers',
      strength: 'hard',
      machine: {
        type: 'always_pair',
        a: { kind: 'tag', tag: 'cuffed-jeans' },
        b: { kind: 'tag', tag: 'white-sneakers' },
      },
    };
    const missing = [item({ id: 'jeans', tags: ['cuffed-jeans'] })];
    expect(findHardViolations(missing, [rule])).toHaveLength(1);

    const satisfied = [
      item({ id: 'jeans', tags: ['cuffed-jeans'] }),
      item({ id: 'kicks', category: 'shoes', tags: ['white-sneakers'] }),
    ];
    expect(findHardViolations(satisfied, [rule])).toHaveLength(0);
  });

  it('ignores soft rules and rules with no machine form', () => {
    const soft: StyleRule = { ...noBrownWithBlack, id: 'r3', strength: 'soft' };
    const prose: StyleRule = {
      id: 'r4',
      text: 'Lean more relaxed on Fridays',
      strength: 'hard',
      machine: null,
    };
    const outfit = [
      item({ id: 'belt', colors: ['brown'] }),
      item({ id: 'shoes', colors: ['black'] }),
    ];
    expect(findHardViolations(outfit, [soft, prose])).toHaveLength(0);
  });
});

describe('scoreCandidate', () => {
  it('prefers an in-season item over a year-round one', () => {
    const inSeason = item({ id: 'a', seasons: ['fall'] });
    const anySeason = item({ id: 'b', seasons: [] });
    expect(scoreCandidate(inSeason, context())).toBeGreaterThan(
      scoreCandidate(anySeason, context()),
    );
  });

  it('prefers favourites', () => {
    expect(scoreCandidate(item({ id: 'a', isFavorite: true }), context())).toBeGreaterThan(
      scoreCandidate(item({ id: 'b', isFavorite: false }), context()),
    );
  });

  it('pushes never-worn items up, which is the point of the app', () => {
    expect(scoreCandidate(item({ id: 'a', wearCount: 0 }), context())).toBeGreaterThan(
      scoreCandidate(item({ id: 'b', wearCount: 30 }), context()),
    );
  });

  it('penalises outerwear when it is warm out', () => {
    const coat = item({ id: 'coat', category: 'outerwear' });
    expect(scoreCandidate(coat, context({ highC: 28 }))).toBeLessThan(
      scoreCandidate(coat, context({ highC: 4 })),
    );
  });

  it('ignores temperature when the forecast is unavailable', () => {
    const coat = item({ id: 'coat', category: 'outerwear' });
    const withoutWeather = scoreCandidate(coat, context({ highC: null }));
    expect(Number.isFinite(withoutWeather)).toBe(true);
  });
});

describe('buildShortlist', () => {
  const many: Candidate[] = Array.from({ length: 20 }, (_unused, i) =>
    item({ id: `top-${String(i).padStart(2, '0')}`, category: 'top', formality: 4 }),
  );

  it('caps each category', () => {
    const shortlist = buildShortlist(many, context(), [], 6);
    expect(shortlist.byCategory.top).toHaveLength(6);
  });

  it('is stable across identical calls', () => {
    const a = buildShortlist(many, context(), [], 6).all.map((i) => i.id);
    const b = buildShortlist(many, context(), [], 6).all.map((i) => i.id);
    expect(a).toEqual(b);
  });

  it('reports why things were left out', () => {
    const shortlist = buildShortlist(
      [item({ id: 'dirty-one', isDirty: true, formality: 4 })],
      context(),
      [],
    );
    expect(shortlist.excluded).toEqual([{ itemId: 'dirty-one', reason: 'dirty' }]);
  });

  it('keeps categories separate', () => {
    const shortlist = buildShortlist(
      [
        item({ id: 'shirt', category: 'top', formality: 4 }),
        item({ id: 'trousers', category: 'bottom', formality: 4 }),
      ],
      context(),
      [],
    );
    expect(shortlist.byCategory.top.map((i) => i.id)).toEqual(['shirt']);
    expect(shortlist.byCategory.bottom.map((i) => i.id)).toEqual(['trousers']);
  });
});

describe('validateProposal', () => {
  const shirt = item({ id: 'shirt', category: 'top', formality: 4 });
  const trousers = item({ id: 'trousers', category: 'bottom', formality: 4 });
  const shortlist = buildShortlist([shirt, trousers], context(), []);

  it('accepts an outfit built from the shortlist', () => {
    const result = validateProposal(
      { itemIds: ['shirt', 'trousers'], reason: 'Clean and appropriate' },
      shortlist,
      [],
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
  });

  it('rejects an item the model invented', () => {
    // The whole anti-hallucination guarantee rests on this test.
    const result = validateProposal(
      { itemIds: ['shirt', 'trousers', 'imaginary-cashmere-scarf'], reason: 'x' },
      shortlist,
      [],
    );
    expect(result.ok).toBe(false);
    expect(result.rejections).toContain('unknown-item');
  });

  it('rejects an item that exists but was filtered out', () => {
    const dirtyShirt = item({ id: 'dirty', category: 'top', formality: 4, isDirty: true });
    const withDirty = buildShortlist([shirt, trousers, dirtyShirt], context(), []);
    const result = validateProposal({ itemIds: ['dirty', 'trousers'], reason: 'x' }, withDirty, []);
    expect(result.rejections).toContain('unknown-item');
  });

  it('rejects a duplicate', () => {
    const result = validateProposal(
      { itemIds: ['shirt', 'shirt', 'trousers'], reason: 'x' },
      shortlist,
      [],
    );
    expect(result.rejections).toContain('duplicate-item');
  });

  it('rejects an outfit with no bottom', () => {
    const result = validateProposal({ itemIds: ['shirt'], reason: 'x' }, shortlist, []);
    expect(result.rejections).toContain('missing-core-piece');
  });

  it('rejects an empty proposal', () => {
    const result = validateProposal({ itemIds: [], reason: 'x' }, shortlist, []);
    expect(result.rejections).toEqual(['empty']);
  });

  it('rejects an outfit that breaks a hard rule', () => {
    const brownBelt = item({ id: 'belt', category: 'accessory', colors: ['brown'], formality: 4 });
    const blackShoes = item({ id: 'shoes', category: 'shoes', colors: ['black'], formality: 4 });
    const full = buildShortlist([shirt, trousers, brownBelt, blackShoes], context(), []);
    const rules: StyleRule[] = [
      {
        id: 'r1',
        text: 'No brown belt with black shoes',
        strength: 'hard',
        machine: {
          type: 'never_pair',
          a: { kind: 'color', color: 'brown' },
          b: { kind: 'color', color: 'black' },
        },
      },
    ];

    const result = validateProposal(
      { itemIds: ['shirt', 'trousers', 'belt', 'shoes'], reason: 'x' },
      full,
      rules,
    );
    expect(result.ok).toBe(false);
    expect(result.rejections).toContain('hard-rule-violation');
    expect(result.violations[0]?.rule.id).toBe('r1');
  });
});

describe('daysSinceWorn', () => {
  it('returns null for something never worn', () => {
    expect(daysSinceWorn(item({ id: 'a' }), NOW)).toBeNull();
  });

  it('returns null rather than NaN for an unparseable date', () => {
    expect(daysSinceWorn(item({ id: 'a', lastWornAt: 'not a date' }), NOW)).toBeNull();
  });

  it('counts whole days', () => {
    const threeDays = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();
    expect(daysSinceWorn(item({ id: 'a', lastWornAt: threeDays }), NOW)).toBe(3);
  });
});
