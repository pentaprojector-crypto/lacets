// Position GPS partagée : un seul suivi pour l'enregistrement, le guidage et le point bleu.
// Un simulateur permet de rejouer un parcours à la maison pour tester le guidage.
import { emit } from './state.js';
import { cumulative, pointAt, bearing } from './geo.js';

const subs = new Set();
let watchId = null;
let last = null;
let sim = null;
let lastError = null;

function normalize(p) {
  const c = p.coords;
  return {
    lon: c.longitude, lat: c.latitude,
    alt: Number.isFinite(c.altitude) ? c.altitude : null,
    acc: c.accuracy ?? 999,
    speed: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
    heading: Number.isFinite(c.heading) ? c.heading : null,
    t: p.timestamp || Date.now(),
  };
}

function emitPos(pos) {
  last = pos;
  lastError = null;
  for (const fn of subs) { try { fn(pos); } catch (e) { console.error(e); } }
  emit('position', pos);
}

function ensureWatch() {
  if (watchId != null || sim || !subs.size) return;
  if (!('geolocation' in navigator)) { lastError = { code: 0, message: 'GPS indisponible sur cet appareil.' }; emit('position-error', lastError); return; }
  watchId = navigator.geolocation.watchPosition(
    (p) => emitPos(normalize(p)),
    (err) => { lastError = err; emit('position-error', err); },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
  );
}

function stopWatch() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

export function subscribe(fn) {
  subs.add(fn);
  ensureWatch();
  return () => {
    subs.delete(fn);
    if (!subs.size) stopWatch();
  };
}

export const lastPosition = () => last;
export const isSimulating = () => !!sim;

export function errorText(err) {
  if (!err) return '';
  if (err.code === 1) return 'Localisation refusée : autorise-la pour Lacets dans les réglages du navigateur.';
  if (err.code === 2) return 'Position introuvable : vérifie que le GPS est activé.';
  if (err.code === 3) return 'Le GPS met du temps à répondre… Reste à découvert.';
  return err.message || 'GPS indisponible.';
}

export function once({ timeout = 15000, maxAge = 30000 } = {}) {
  if (last && Date.now() - last.t < maxAge) return Promise.resolve(last);
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject({ code: 0, message: 'GPS indisponible sur cet appareil.' }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { const pos = normalize(p); last = pos; resolve(pos); },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout, maximumAge: maxAge },
    );
  });
}

/** Rejoue un tracé à vitesse donnée (km/h) en émettant une position par seconde. */
export function startSimulation(coords, kmh = 70) {
  stopSimulation();
  stopWatch();
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  let d = 0;
  let prev = coords[0];
  const t0 = Date.now();
  sim = { timer: null };
  const tick = () => {
    const wobble = 1 + 0.25 * Math.sin((Date.now() - t0) / 9000);
    const v = (kmh / 3.6) * wobble;
    d = Math.min(total, d + v);
    const p = pointAt(coords, cum, d);
    const ahead = pointAt(coords, cum, Math.min(total, d + 15));
    const alt = 300 + 200 * Math.sin(d / 4000);
    emitPos({ lon: p[0], lat: p[1], alt, acc: 6, speed: v, heading: bearing(prev, ahead), t: Date.now(), simulated: true });
    prev = p;
    if (d >= total) stopSimulation();
  };
  tick();
  sim.timer = setInterval(tick, 1000);
  emit('simulation', true);
}

export function stopSimulation() {
  if (!sim) return;
  clearInterval(sim.timer);
  sim = null;
  emit('simulation', false);
  ensureWatch();
}
