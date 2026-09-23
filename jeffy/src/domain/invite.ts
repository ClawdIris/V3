import type { RedeemStatus } from '@/types/database';

/**
 * Invite-code handling on the client.
 *
 * normaliseInviteCode MUST stay identical to hash_invite_code() in
 * supabase/migrations/0003: uppercase, then strip everything that is not a
 * letter or digit. If the two ever diverge, valid codes start failing.
 */

/** No I, O, 0 or 1: codes get read aloud and typed from screenshots. */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

const INVITE_CODE_PATTERN = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

export function normaliseInviteCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * A cheap client-side check so an obviously wrong code shows an error without
 * a round trip. It is never a substitute for redeem_invite(), which is the
 * only thing that decides whether a code is real.
 */
export function isWellFormedInviteCode(input: string): boolean {
  return INVITE_CODE_PATTERN.test(normaliseInviteCode(input));
}

/** Display form: ABCD-EFGH. Grouping roughly halves transcription errors. */
export function formatInviteCode(code: string): string {
  const normalised = normaliseInviteCode(code);
  if (normalised.length !== INVITE_CODE_LENGTH) return normalised;
  return `${normalised.slice(0, 4)}-${normalised.slice(4)}`;
}

/**
 * The share link. `jeffy://` opens the app directly; the https form is what
 * actually survives being pasted into Messages, and needs a universal-link
 * association file once there is a domain to host it on.
 */
export function inviteDeepLink(code: string): string {
  return `jeffy://join/${normaliseInviteCode(code)}`;
}

export function inviteShareMessage(
  code: string,
  ownerName: string | null,
  link: string | null = null,
): string {
  const who = ownerName ?? 'Someone';
  const open = link === null ? 'Open the app, sign up, then enter the code.' : `Open ${link}, sign up, and the code is filled in for you.`;
  return (
    `${who} wants you to style their closet on Jeffy.\n\n` +
    `Your code: ${formatInviteCode(code)}\n\n` +
    open
  );
}

export interface RedeemOutcome {
  readonly ok: boolean;
  /** Shown to the user verbatim. */
  readonly message: string;
  /** True when trying a different code could plausibly work. */
  readonly retryable: boolean;
}

export function describeRedeemStatus(
  status: RedeemStatus,
  closetOwnerName: string | null = null,
): RedeemOutcome {
  switch (status) {
    case 'accepted':
      return {
        ok: true,
        message: closetOwnerName
          ? `You're now styling ${closetOwnerName}'s closet.`
          : "You're in.",
        retryable: false,
      };
    case 'invalid':
      return {
        ok: false,
        message: "That code doesn't match any invite. Check it and try again.",
        retryable: true,
      };
    case 'expired':
      return {
        ok: false,
        message: 'That invite has expired. Ask for a fresh code.',
        retryable: true,
      };
    case 'already_used':
      return {
        ok: false,
        message: 'That code has already been used. Invites work exactly once.',
        retryable: true,
      };
    case 'revoked':
      return {
        ok: false,
        message: 'That invite was cancelled. Ask for a fresh code.',
        retryable: true,
      };
    case 'own_closet':
      return {
        ok: false,
        message: "That's an invite to your own closet — you already have access.",
        retryable: false,
      };
    case 'already_member':
      return {
        ok: false,
        message: "You're already a stylist on that closet.",
        retryable: false,
      };
  }
}

export interface InviteSummary {
  readonly id: string;
  readonly codeHint: string;
  readonly expiresAt: string;
  readonly redeemedAt: string | null;
  readonly revokedAt: string | null;
}

export type InviteState = 'pending' | 'accepted' | 'revoked' | 'expired';

export function inviteState(invite: InviteSummary, now: Date = new Date()): InviteState {
  if (invite.revokedAt !== null) return 'revoked';
  if (invite.redeemedAt !== null) return 'accepted';
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'pending';
}
