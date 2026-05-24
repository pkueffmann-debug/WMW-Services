/* Aurelys — minimal service worker
   Strategy:
   - App shell + assets: cache-first with network fallback (offline-capable)
   - API + Supabase: always network (no caching of dynamic data)
*/
const CACHE = 'aurelys-shell-v4';
const SHELL = [
  '/app/',
  '/app/index.html',
  '/app/manifest.json',
  '/app/assets/app.css',
  '/app/assets/app.js',
  '/app/assets/auth.js',
  '/app/assets/storage.js',
  '/app/assets/llm.js',
  '/app/assets/views/today.js',
  '/app/assets/views/constellation.js',
  '/app/assets/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Bypass cache for API + Supabase + external API calls
  if (url.pathname.startsWith('/api/')) return;
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('anthropic.com')) return;
  if (url.hostname.includes('openai.com')) return;
  if (url.hostname === 'localhost' && url.port === '11434') return;

  // App-shell-only caching
  if (!url.pathname.startsWith('/app/')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => cached))
  );
});
