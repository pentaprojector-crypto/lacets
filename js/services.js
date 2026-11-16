// Services en ligne gratuits : routage moto (Valhalla FOSSGIS), secours OSRM, recherche (Photon), altitude (Open-Meteo).
// Les serveurs FOSSGIS demandent au plus une requête par seconde : toutes les requêtes passent par une file.
import { decodePolyline } from './geo.js';
import { sleep } from './ui.js';

export const ENDPOINTS = {
  valhalla: 'https://valhalla1.openstreetmap.de',
  osrm: 'https://routing.openstreetmap.de/routed-car',
  photon: 'https://photon.komoot.io',
  elevation: 'https://api.open-meteo.com/v1/elevation',
};

class Queue {
  constructor(gap) { this.gap = gap; this.next = 0; this.chain = Promise.resolve(); }
  run(fn) {
    const p = this.chain.then(async () => {
      const wait = this.next - Date.now();
      if (wait > 0) await sleep(wait);
      this.next = Date.now() + this.gap;
      return fn();
    });
    this.chain = p.catch(() => {});
    return p;
  }
}
const routingQ = new Queue(1100);
const photonQ = new Queue(1000);
const elevQ = new Queue(250);

export class ServiceError extends Error {
  constructor(message, { status, code, offline } = {}) { super(message); this.status = status; this.code = code; this.offline = offline; }
}

async function fetchJson(url, { timeout = 20000, signal } = {}) {
  if (!navigator.onLine) throw new ServiceError('Pas de connexion réseau.', { offline: true });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    let res;
    try { res = await fetch(url, { signal: ctrl.signal }); }
    catch (e) {
      if (signal?.aborted) throw e;
      throw new ServiceError(ctrl.signal.aborted ? 'Le service ne répond pas (délai dépassé).' : 'Service injoignable.', { offline: !navigator.onLine });
    }
    let body = null;
    try { body = await res.json(); } catch { /* corps non JSON */ }
    if (!res.ok) throw new ServiceError(body?.error || body?.message || `Erreur ${res.status}`, { status: res.status, code: body?.error_code });
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* ---------- routage moto ---------- */
export const PROFILES = {
  virolos: { label: 'Virolos', hint: 'Routes sinueuses, ni autoroute ni péage', opts: { use_highways: 0, use_tolls: 0, use_curvature: 1, use_trails: 0 } },
  balade: { label: 'Balade', hint: 'Routes secondaires, autoroute évitée si possible', opts: { use_highways: 0.15, use_tolls: 0.2, use_curvature: 0.7, use_trails: 0 } },
  rapide: { label: 'Rapide', hint: 'Au plus vite, autoroutes comprises', opts: { use_highways: 1, use_tolls: 0.5, use_curvature: 0.5, use_trails: 0 } },
};

export function costingOptions(o = {}) {
  const c = { ...(PROFILES[o.profile] || PROFILES.balade).opts };
  if (o.avoidHighways) c.use_highways = 0;
  if (o.avoidTolls) c.use_tolls = 0;
  c.use_ferry = o.avoidFerries ? 0 : 0.5;
  if (o.avoidUnpaved) { c.exclude_unpaved = true; c.use_tracks = 0; }
  return c;
}

const mapManeuver = (m) => ({
  type: m.type,
  text: m.instruction || '',
  alert: m.verbal_transition_alert_instruction || '',
  pre: m.verbal_pre_transition_instruction || m.instruction || '',
  streets: m.street_names || m.begin_street_names || [],
  i: m.begin_shape_index || 0,
  len: (m.length || 0) * 1000,
  time: m.time || 0,
  exit: m.roundabout_exit_count || 0,
});

/** Calcule un itinéraire moto passant par les points donnés. Une étape (leg) par paire de points. */
export async function routeValhalla(points, options, { signal } = {}) {
  const locations = points.map((p, i) => ({
    lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6),
    type: i === 0 || i === points.length - 1 ? 'break' : 'break_through',
  }));
  const req = {
    locations,
    costing: 'motorcycle',
    costing_options: { motorcycle: costingOptions(options) },
    units: 'kilometers',
    language: 'fr-FR',
    directions_options: { units: 'kilometers', language: 'fr-FR' },
    id: 'lacets',
  };
  const url = `${ENDPOINTS.valhalla}/route?json=${encodeURIComponent(JSON.stringify(req))}`;
  const data = await routingQ.run(() => fetchJson(url, { signal, timeout: 30000 }));
  if (!data?.trip?.legs) throw new ServiceError('Réponse de routage inattendue.');
  return {
    engine: 'valhalla',
    legs: data.trip.legs.map((leg) => ({
      coords: decodePolyline(leg.shape, 6),
      length: (leg.summary?.length || 0) * 1000,
      time: leg.summary?.time || 0,
      maneuvers: (leg.maneuvers || []).map(mapManeuver),
    })),
  };
}

/** Secours : OSRM voiture (sans options moto ni consignes). */
export async function routeOsrm(points, { signal } = {}) {
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${ENDPOINTS.osrm}/route/v1/driving/${coords}?overview=false&steps=true&geometries=polyline6`;
  const data = await routingQ.run(() => fetchJson(url, { signal }));
  if (data?.code !== 'Ok' || !data.routes?.length) throw new ServiceError(data?.message || 'Aucun itinéraire trouvé.');
  return {
    engine: 'osrm',
    legs: data.routes[0].legs.map((leg) => {
      const c = [];
      for (const st of leg.steps) {
        const g = decodePolyline(st.geometry, 6);
        if (c.length) g.shift();
        c.push(...g);
      }
      return { coords: c, length: leg.distance, time: leg.duration, maneuvers: [] };
    }),
  };
}

export function routingErrorText(err) {
  if (err?.offline) return 'Hors connexion : le calcul d’itinéraire a besoin du réseau.';
  const code = err?.code;
  if (code === 171 || code === 170) return 'Point trop loin d’une route : rapproche-le d’une route.';
  if (code === 442 || code === 443) return 'Aucun itinéraire moto trouvé entre ces points.';
  if (code === 154 || code === 150) return 'Trop de points ou distance trop grande pour un seul calcul.';
  if (err?.status === 429) return 'Service de routage saturé : réessaie dans quelques secondes.';
  return err?.message || 'Le calcul d’itinéraire a échoué.';
}

/* ---------- recherche de lieux ---------- */
let photonLang = 'fr';
function placeFrom(f) {
  const p = f.properties || {};
  const [lon, lat] = f.geometry.coordinates;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || street || p.city || p.county || 'Lieu';
  const locality = p.city || p.town || p.village || p.locality || p.district;
  const details = [p.name && street ? street : null, p.postcode, locality !== name ? locality : null, p.county !== locality ? p.county : null, p.country && p.countrycode !== 'FR' ? p.country : null]
    .filter(Boolean);
  return { name, label: [...new Set(details)].join(', '), lon, lat, type: p.osm_value || p.type };
}

async function photon(path, params, opts) {
  const run = () => fetchJson(`${ENDPOINTS.photon}${path}?${params}`, { timeout: 10000, ...opts });
  try {
    return await photonQ.run(run);
  } catch (e) {
    if (e.status === 400 && params.has('lang')) { // langue refusée par le serveur : on réessaie sans
      photonLang = null;
      params.delete('lang');
      return photonQ.run(run);
    }
    throw e;
  }
}

export async function searchPlaces(q, near, { signal } = {}) {
  const params = new URLSearchParams({ q, limit: '7' });
  if (photonLang) params.set('lang', photonLang);
  if (near) { params.set('lat', near[1].toFixed(4)); params.set('lon', near[0].toFixed(4)); }
  const data = await photon('/api/', params, { signal });
  return (data?.features || []).map(placeFrom);
}

export async function reverseName(lon, lat) {
  const params = new URLSearchParams({ lon: lon.toFixed(6), lat: lat.toFixed(6), limit: '1' });
  if (photonLang) params.set('lang', photonLang);
  try {
    const data = await photon('/reverse', params, {});
    const f = data?.features?.[0];
    if (!f) return null;
    const p = f.properties || {};
    const locality = p.city || p.town || p.village || p.locality || p.district || p.county;
    const main = p.name || p.street;
    return [main, locality !== main ? locality : null].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}

/* ---------- altitude ---------- */
export async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const lat = chunk.map((p) => p[1].toFixed(5)).join(',');
    const lon = chunk.map((p) => p[0].toFixed(5)).join(',');
    const data = await elevQ.run(() => fetchJson(`${ENDPOINTS.elevation}?latitude=${lat}&longitude=${lon}`, { timeout: 15000 }));
    if (!Array.isArray(data?.elevation)) throw new ServiceError('Altitudes indisponibles.');
    out.push(...data.elevation);
  }
  return out;
}
