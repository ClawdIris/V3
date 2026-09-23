import { Platform } from 'react-native';

/**
 * URLs that differ between the installed app and the web build.
 *
 * On native the scheme is jeffy://. On the web it is wherever the app is
 * hosted, read at runtime so the same build works on a preview URL and on
 * the real domain.
 */

function webOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export function passwordResetRedirect(): string {
  return Platform.OS === 'web' ? `${webOrigin()}/reset-password` : 'jeffy://reset-password';
}

export function joinLink(code: string): string {
  return Platform.OS === 'web'
    ? `${webOrigin()}/join?code=${encodeURIComponent(code)}`
    : `jeffy://join/${code}`;
}
