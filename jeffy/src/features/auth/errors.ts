import { AuthError } from '@supabase/supabase-js';

/**
 * Turns a thrown auth error into something worth showing a person.
 *
 * Returns null for errors that should produce no UI at all — chiefly the user
 * cancelling the Apple sheet, which is a decision, not a failure.
 */
export function describeAuthError(cause: unknown): string | null {
  if (isCancellation(cause)) return null;

  if (cause instanceof AuthError) {
    switch (cause.code) {
      case 'invalid_credentials':
        return 'That email and password do not match.';
      case 'email_not_confirmed':
        return 'Check your email and confirm your address first.';
      case 'user_already_exists':
      case 'email_exists':
        return 'There is already an account with that email. Try signing in.';
      case 'weak_password':
        return 'That password is too weak. Use at least 8 characters.';
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return 'Too many attempts. Wait a minute and try again.';
      case 'validation_failed':
        return 'That does not look like a valid email address.';
      default:
        return cause.message;
    }
  }

  if (isNetworkFailure(cause)) {
    return 'Cannot reach the server. Check your connection and try again.';
  }

  if (cause instanceof Error) return cause.message;
  return 'Something went wrong. Try again.';
}

/**
 * fetch() reports a dead network as a TypeError whose message differs by
 * platform: "Failed to fetch" (Chromium), "Load failed" (Safari), "Network
 * request failed" (React Native). None of those belong on screen.
 */
function isNetworkFailure(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return /failed to fetch|load failed|network request failed|networkerror/i.test(cause.message);
}

function isCancellation(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const code = (cause as { code?: unknown }).code;
  // expo-apple-authentication throws ERR_REQUEST_CANCELED on the cancel tap.
  return code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED';
}
