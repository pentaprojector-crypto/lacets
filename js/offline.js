// Carte hors ligne : les tuiles vectorielles OpenFreeMap passent par un cache local
// (protocole personnalisé MapLibre), et un parcours peut être préchargé avant de partir.
import { toast, confirmBox, fmtInt } from './ui.js';
import { cumulative, sampleAlong } from './geo.js';

export const TILE_CACHE = 'lacets-tuiles-v1';
const MAX_ENTRIES = 9000;
const OFM = 'https://tiles.openfreemap.org/';
let puts = 0;

async function trim(cache) {
  if (++puts % 150) return;
  const keys = await cache.keys();
  const extra = keys.length - MAX_ENTRIES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function cachedFetch(url, { networkFirst = false, signal } = {}) {
  const cache = await caches.open(TILE_CACHE);
  if (!networkFirst) {
    const hit = await cache.match(url);
    if (hit) return hit;
  }
  try {
    const res = await fetch(url, { signal });
    if (res.ok) { cache.put(url, res.clone()).then(() => trim(cache)).catch(() => {}); return res; }
    if (networkFirst) { const hit = await cache.match(url); if (hit) return hit; }
    return res;
  } catch (e) {
    if (signal?.aborted) throw e;
    const hit = await cache.match(url);
    if (hit) return hit;
    throw e;
  }
}

export function setupTileCache() {
  if (!('caches' in window) || !window.maplibregl?.addProtocol) return false;
  maplibregl.addProtocol('lcache', async (params, abortController) => {
    const url = params.url.replace(/^lcache:/, 'https:');
    const res = await cachedFetch(url, { networkFirst: params.type === 'json', signal: abortController.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (params.type === 'json') return { data: await res.json() };
    return { data: await res.arrayBuffer() };
  });
  return true;
}

let cacheReady = false;
export function enableTileCache() { cacheReady = setupTileCache(); return cacheReady; }

/** À passer à MapLibre (option transformRequest). */
export function transformRequest(url, type) {
  const vectorTile = type === 'Tile' && /\.pbf(\?|$)/.test(url);
  if (cacheReady && url.startsWith(OFM) && (vectorTile || type === 'Glyphs' || type === 'Source' || type === 'Style')) {
    return { url: url.replace(/^https:/, 'lcache:') };
  }
  return undefined;
}

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

export function corridorTiles(coords, zmin = 6, zmax = 14) {
  const cum = cumulative(coords);
  const total = cum[cum.length - 1] || 1;
  const lat = coords[Math.floor(coords.length / 2)][1];
  const seen = new Set();
  const out = [];
  for (let z = zmin; z <= zmax; z++) {
    const tileM = (40075016 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    const n = Math.min(30000, Math.ceil(total / (tileM / 3)) + 2);
    const pad = z >= 13 ? 1 : 0;
    for (const [lon, la] of sampleAlong(coords, cum, n)) {
      const x = lon2x(lon, z), y = lat2y(la, z);
      for (let dx = -pad; dx <= pad; dx++) for (let dy = -pad; dy <= pad; dy++) {
        const k = `${z}/${x + dx}/${y + dy}`;
        if (!seen.has(k)) { seen.add(k); out.push([z, x + dx, y + dy]); }
      }
    }
  }
  return out;
}

export async function prepareOffline(coords) {
  if (!coords || coords.length < 2) return;
  if (!('caches' in window)) { toast('Ce navigateur ne permet pas la carte hors ligne.', { error: true }); return; }
  if (!navigator.onLine) { toast('Connecte-toi (en Wi-Fi de préférence) pour télécharger la carte.', { error: true }); return; }
  let progress;
  try {
    const json = async (u) => (await cachedFetch(u, { networkFirst: true })).json();
    const style = await json(`${OFM}styles/liberty`);
    json(`${OFM}styles/dark`).catch(() => null);
    const src = Object.values(style.sources).find((s) => s.type === 'vector' && s.url);
    const tilejson = await json(src.url);
    const template = tilejson.tiles[0];
    const tiles = corridorTiles(coords);
    const megas = Math.max(1, Math.round(tiles.length * 0.035));
    const ok = await confirmBox({
      title: 'Préparer la carte hors ligne ?',
      text: `${fmtInt(tiles.length)} morceaux de carte le long du parcours (environ ${megas} Mo), pour les fonds Routier et Nuit. Mieux vaut le faire en Wi-Fi.`,
      ok: 'Télécharger',
    });
    if (!ok) return;
    const urls = tiles.map(([z, x, y]) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    const fonts = new Set();
    for (const l of style.layers) {
      const f = l.layout?.['text-font'];
      if (Array.isArray(f) && f.every((s) => typeof s === 'string')) fonts.add(f.join(','));
    }
    if (style.glyphs) for (const fs of fonts) for (const range of ['0-255', '256-511', '8192-8447']) urls.push(style.glyphs.replace('{fontstack}', fs).replace('{range}', range));
    const cache = await caches.open(TILE_CACHE);
    progress = toast('Téléchargement de la carte : 0 %', { timeout: 0 });
    let done = 0, failed = 0, idx = 0;
    const work = async () => {
      while (idx < urls.length) {
        const u = urls[idx++];
        try {
          if (!(await cache.match(u))) {
            const r = await fetch(u);
            if (r.ok) await cache.put(u, r); else failed++;
          }
        } catch { failed++; }
        done++;
        if (done % 8 === 0) progress.firstChild.textContent = `Téléchargement de la carte : ${Math.round((done / urls.length) * 100)} %`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, work));
    progress.remove();
    toast(failed ? `Carte prête, sauf ${failed} morceaux (réseau). Relance pour compléter.` : 'Carte prête hors ligne pour ce parcours.', { timeout: 6000 });
  } catch (e) {
    progress?.remove();
    toast(`Préparation hors ligne impossible : ${e.message || e}`, { error: true });
  }
}

export async function tileCacheSize() {
  try { return (await (await caches.open(TILE_CACHE)).keys()).length; } catch { return 0; }
}
export async function clearTileCache() {
  try { await caches.delete(TILE_CACHE); } catch { /* rien */ }
}
