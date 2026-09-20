import {
  INVITE_ALPHABET,
  describeRedeemStatus,
  formatInviteCode,
  inviteDeepLink,
  inviteShareMessage,
  inviteState,
  isWellFormedInviteCode,
  normaliseInviteCode,
  type InviteSummary,
} from '../invite';
import { REDEEM_STATUSES } from '@/types/database';

describe('normaliseInviteCode', () => {
  it('matches hash_invite_code(): uppercase, alphanumerics only', () => {
    // These four must all hash to the same value as the issued code, or a
    // user reading a code aloud gets an "invalid code" error.
    expect(normaliseInviteCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normaliseInviteCode('ABCD EFGH')).toBe('ABCDEFGH');
    expect(normaliseInviteCode('  abcdefgh  ')).toBe('ABCDEFGH');
    expect(normaliseInviteCode('a.b,c-d_e f/g!h')).toBe('ABCDEFGH');
  });

  it('leaves an already-normal code alone', () => {
    expect(normaliseInviteCode('K7MNP2QR')).toBe('K7MNP2QR');
  });
});

describe('isWellFormedInviteCode', () => {
  it('accepts a code of the right length from the right alphabet', () => {
    expect(isWellFormedInviteCode('K7MNP2QR')).toBe(true);
    expect(isWellFormedInviteCode('k7mnp2qr')).toBe(true);
    expect(isWellFormedInviteCode('K7MN-P2QR')).toBe(true);
  });

  it('rejects the ambiguous characters the generator never emits', () => {
    // I, O, 0 and 1 are excluded precisely so they cannot be confused.
    for (const bad of ['I', 'O', '0', '1']) {
      expect(INVITE_ALPHABET).not.toContain(bad);
      expect(isWellFormedInviteCode(`${bad}7MNP2QR`)).toBe(false);
    }
  });

  it('rejects the wrong length', () => {
    expect(isWellFormedInviteCode('K7MNP2Q')).toBe(false);
    expect(isWellFormedInviteCode('K7MNP2QRS')).toBe(false);
    expect(isWellFormedInviteCode('')).toBe(false);
  });
});

describe('formatInviteCode', () => {
  it('groups into two blocks of four', () => {
    expect(formatInviteCode('K7MNP2QR')).toBe('K7MN-P2QR');
  });

  it('normalises before grouping', () => {
    expect(formatInviteCode('k7mn p2qr')).toBe('K7MN-P2QR');
  });

  it('leaves a wrong-length code ungrouped rather than mangling it', () => {
    expect(formatInviteCode('K7MN')).toBe('K7MN');
  });
});

describe('sharing', () => {
  it('builds a deep link from the normalised code', () => {
    expect(inviteDeepLink('k7mn-p2qr')).toBe('jeffy://join/K7MNP2QR');
  });

  it('puts the readable code in the share message', () => {
    const message = inviteShareMessage('K7MNP2QR', 'Jeff');
    expect(message).toContain('K7MN-P2QR');
    expect(message).toContain('Jeff');
  });

  it('copes with an owner who never set a display name', () => {
    expect(inviteShareMessage('K7MNP2QR', null)).toContain('Someone');
  });
});

describe('describeRedeemStatus', () => {
  it('handles every status the database can return', () => {
    // Guards against a status being added to the enum without a message.
    for (const status of REDEEM_STATUSES) {
      const outcome = describeRedeemStatus(status);
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });

  it('marks only acceptance as ok', () => {
    expect(describeRedeemStatus('accepted').ok).toBe(true);
    for (const status of REDEEM_STATUSES.filter((s) => s !== 'accepted')) {
      expect(describeRedeemStatus(status).ok).toBe(false);
    }
  });

  it('names the owner on success when known', () => {
    expect(describeRedeemStatus('accepted', 'Jeff').message).toContain('Jeff');
  });

  it('suggests retrying only when a different code could work', () => {
    expect(describeRedeemStatus('invalid').retryable).toBe(true);
    expect(describeRedeemStatus('expired').retryable).toBe(true);
    expect(describeRedeemStatus('already_used').retryable).toBe(true);
    // Already having access is not fixed by typing another code.
    expect(describeRedeemStatus('own_closet').retryable).toBe(false);
    expect(describeRedeemStatus('already_member').retryable).toBe(false);
  });
});

describe('inviteState', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  const base: InviteSummary = {
    id: 'i1',
    codeHint: 'P2QR',
    expiresAt: '2026-03-08T12:00:00Z',
    redeemedAt: null,
    revokedAt: null,
  };

  it('is pending before expiry', () => {
    expect(inviteState(base, now)).toBe('pending');
  });

  it('is expired once the deadline passes', () => {
    expect(inviteState({ ...base, expiresAt: '2026-02-28T12:00:00Z' }, now)).toBe('expired');
  });

  it('treats the exact expiry instant as expired', () => {
    expect(inviteState({ ...base, expiresAt: now.toISOString() }, now)).toBe('expired');
  });

  it('is accepted once redeemed', () => {
    expect(inviteState({ ...base, redeemedAt: '2026-03-02T09:00:00Z' }, now)).toBe('accepted');
  });

  it('reports revoked ahead of everything else', () => {
    const revoked = {
      ...base,
      redeemedAt: '2026-03-02T09:00:00Z',
      revokedAt: '2026-03-03T09:00:00Z',
    };
    expect(inviteState(revoked, now)).toBe('revoked');
  });
});
