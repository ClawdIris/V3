/* Jeffy service worker.
 *
 * Deliberately small. Three rules:
 *   1. Hashed build assets (/_expo/static/...) are immutable: cache-first, forever.
 *   2. Navigations are network-first, falling back to the cached shell, so the
 *      app opens offline and still picks up new deploys when online.
 *   3. Everything else -- Supabase REST, Storage signed URLs, Edge Functions --
 *      is passed straight through. Those responses are per-user, RLS-scoped
 *      and short-lived; caching them here would be a privacy bug, not a
 *      feature. Closet data is cached by the app itself (TanStack persister).
 */
const VERSION = 'jeffy-v1';
const SHELL = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Rule 1: immutable build output.
  if (sameOrigin && (url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/icons/'))) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Rule 2: the app shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(VERSION).then((cache) => cache.put('/', response.clone()));
          }
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Rule 3: everything else is not ours to cache.
});
