// Service worker de Lacets : appli disponible hors connexion, cache des fonds raster,
// réception des fichiers GPX partagés depuis Android (« Partager → Lacets »).
const VERSION = 'lacets-vd9370ec1ac';
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/carte.js",
  "js/community.js",
  "js/db.js",
  "js/exif.js",
  "js/geo.js",
  "js/gpx.js",
  "js/library.js",
  "js/location.js",
  "js/main.js",
  "js/mapview.js",
  "js/offline.js",
  "js/photos.js",
  "js/planner.js",
  "js/profile.js",
  "js/recorder.js",
  "js/ride.js",
  "js/services.js",
  "js/settings.js",
  "js/state.js",
  "js/ui.js",
  "js/zip.js",
  "vendor/maplibre-gl.css",
  "vendor/maplibre-gl.js",
  "vendor/supabase.js",
  "vendor/fonts/barlow-condensed-latin-500-normal.woff2",
  "vendor/fonts/barlow-condensed-latin-600-normal.woff2",
  "vendor/fonts/barlow-condensed-latin-700-normal.woff2",
  "vendor/fonts/barlow-latin-400-normal.woff2",
  "vendor/fonts/barlow-latin-500-normal.woff2",
  "vendor/fonts/barlow-latin-600-normal.woff2",
  "vendor/fonts/barlow-latin-700-normal.woff2",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/shortcut-plan.png"
];
const RASTER_CACHE = 'lacets-raster-v1';
const RASTER_MAX = 4000;
const RASTER_HOSTS = /(^|\.)(data\.geopf\.fr|tile\.opentopomap\.org)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('lacets-v') && key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

let puts = 0;
async function rasterTile(request) {
  const cache = await caches.open(RASTER_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    if (++puts % 200 === 0) {
      const keys = await cache.keys();
      for (let i = 0; i < keys.length - RASTER_MAX; i++) await cache.delete(keys[i]);
    }
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RASTER_CACHE);
  const hit = await cache.match(request);
  const net = fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open('lacets-partage');
  let i = 0;
  for (const value of form.getAll('gpx')) {
    if (typeof value === 'string') continue;
    await cache.put(`partage/${Date.now()}-${i++}`, new Response(value, { headers: { 'x-filename': encodeURIComponent(value.name || 'partage.gpx') } }));
  }
  return Response.redirect(new URL('./?partage=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/partage')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
      return;
    }
    event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
    return;
  }
  if (RASTER_HOSTS.test(url.hostname)) { event.respondWith(rasterTile(req)); return; }
  if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/natural_earth/') && !url.pathname.endsWith('.json')) { event.respondWith(rasterTile(req)); return; }
  if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/sprites/')) event.respondWith(staleWhileRevalidate(req));
});
