/* KomaYomi service worker: precaches the built app shell so the UI opens offline. */
const VERSION = '1';
const CACHE = `komayomi-shell-v${VERSION}`;
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // The html must be fresh: it names the hashed assets of this build.
      const index = await fetch('/index.html', { cache: 'reload' });
      if (!index.ok) throw new Error(`shell ${index.status}`);
      await cache.put('/index.html', index.clone());
      await cache.put('/', index.clone());
      const html = await index.text();
      const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
      const rest = SHELL.filter((path) => path !== '/' && path !== '/index.html');
      await Promise.all([...rest, ...assets].map((path) => cache.add(path).catch(() => undefined)));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith('komayomi-shell-') && key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API calls, page images and thumbnails must reflect the live local library.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/raw/') || url.pathname.startsWith('/thumb')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match('/index.html')) || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        // Vite stamps files with `Vary: Accept-Language`, which would reject a valid
        // hit when the request headers differ; hashed asset urls never change content.
        const hit = await cache.match(request, { ignoreVary: true });
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});
