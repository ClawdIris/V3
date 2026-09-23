/**
 * Web build of the session storage adapter.
 *
 * There is no keychain in a browser. localStorage is what Supabase uses by
 * default on the web and it is the honest option: the session is only as
 * protected as the device's own lock screen, which is the same guarantee every
 * web app you are signed into makes. Tokens are short-lived, so the exposure
 * from a copied localStorage is bounded.
 *
 * Same interface as the native adapter, so nothing above this file changes.
 */

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Safari private mode and some embedded webviews throw on access.
    return null;
  }
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    return storage()?.getItem(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    storage()?.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    storage()?.removeItem(key);
  },
};
