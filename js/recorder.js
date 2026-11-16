// Enregistrement GPS d'une balade : filtrage des points, statistiques en direct,
// sauvegarde régulière (reprise après fermeture de l'appli), écran maintenu allumé.
import { subscribe } from './location.js';
import { kv, saveItem, deleteItem } from './db.js';
import { dist, computeStats, previewOf } from './geo.js';
import { emit } from './state.js';
import { uid, fmtDateLong } from './ui.js';

const blank = () => ({
  state: 'idle', id: null, startedAt: null, segments: [], dist: 0, moving: 0, maxSpeed: 0, gain: 0, loss: 0,
  eleAnchor: null, speed: null, alt: null, acc: null, followId: null, lastSave: 0, lastFix: 0,
});
const rec = blank();
let unsub = null;

export const recording = () => rec;
export const isActive = () => rec.state === 'recording' || rec.state === 'paused';
export const elapsed = () => (rec.startedAt ? (Date.now() - rec.startedAt) / 1000 : 0);

/* ---------- écran allumé ---------- */
let wakeLock = null, wakeWanted = 0;
async function acquire() {
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* refusé (batterie faible, etc.) */ }
}
export function keepAwake(on) {
  wakeWanted = Math.max(0, wakeWanted + (on ? 1 : -1));
  if (wakeWanted) acquire();
  else if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
window.addEventListener('pagehide', () => { if (isActive()) persist(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeWanted) acquire();
  if (document.visibilityState === 'hidden' && isActive()) persist();
});

/* ---------- points ---------- */
function onPos(p) {
  rec.speed = p.speed != null ? p.speed * 3.6 : rec.speed;
  rec.alt = p.alt;
  rec.acc = p.acc;
  rec.lastFix = Date.now();
  if (rec.state !== 'recording' || p.acc > 40) { emit('rec-tick', rec); return; }
  const pt = [+p.lon.toFixed(6), +p.lat.toFixed(6), p.alt != null ? Math.round(p.alt * 10) / 10 : null, p.t];
  const seg = rec.segments[rec.segments.length - 1];
  const prev = seg[seg.length - 1];
  if (prev) {
    const d = dist(prev, pt);
    const dt = (pt[3] - prev[3]) / 1000;
    if (dt <= 0 || d / dt > 90) { emit('rec-tick', rec); return; } // doublon ou saut GPS aberrant
    if (d < 4 && dt < 15) { emit('rec-tick', rec); return; } // à l'arrêt : inutile d'empiler des points
    rec.dist += d;
    if (d / dt > 0.9 && dt < 120) rec.moving += dt;
    const v = p.speed != null ? p.speed * 3.6 : (d / dt) * 3.6;
    if (p.speed == null) rec.speed = v;
    if (v > rec.maxSpeed && v < 330 && p.acc < 25) rec.maxSpeed = v;
  }
  if (pt[2] != null) {
    if (rec.eleAnchor == null) rec.eleAnchor = pt[2];
    else if (pt[2] - rec.eleAnchor >= 6) { rec.gain += pt[2] - rec.eleAnchor; rec.eleAnchor = pt[2]; }
    else if (rec.eleAnchor - pt[2] >= 6) { rec.loss += rec.eleAnchor - pt[2]; rec.eleAnchor = pt[2]; }
  }
  seg.push(pt);
  emit('rec-point', { rec, pt });
  if (Date.now() - rec.lastSave > 10000) persist();
}

async function persist() {
  if (!isActive()) return;
  rec.lastSave = Date.now();
  const { state, id, startedAt, segments, dist: d, moving, maxSpeed, gain, loss, eleAnchor, followId } = rec;
  try { await kv.set('recording', { state, id, startedAt, segments, dist: d, moving, maxSpeed, gain, loss, eleAnchor, followId, savedAt: Date.now() }); }
  catch { /* stockage plein : on réessaiera */ }
}

/* ---------- commandes ---------- */
export function start({ followId = null } = {}) {
  if (isActive()) return;
  Object.assign(rec, blank(), { state: 'recording', id: uid(), startedAt: Date.now(), segments: [[]], followId });
  unsub?.();
  unsub = subscribe(onPos);
  keepAwake(true);
  persist();
  emit('rec-state', rec);
}

export function pause() {
  if (rec.state !== 'recording') return;
  rec.state = 'paused';
  persist();
  emit('rec-state', rec);
}

export function resume() {
  if (rec.state !== 'paused') return;
  rec.state = 'recording';
  if (rec.segments.at(-1)?.length) rec.segments.push([]);
  persist();
  emit('rec-state', rec);
}

export const defaultName = (t) => `Balade du ${fmtDateLong(t)}`;

/** Termine l'enregistrement. Renvoie le parcours créé (ou null si supprimé / trop court). */
export async function stop({ name = '', discard = false } = {}) {
  if (!isActive()) return null;
  unsub?.(); unsub = null;
  keepAwake(false);
  const r = { ...rec };
  const segments = r.segments.filter((s) => s.length > 1);
  let meta = null;
  if (!discard && segments.length) {
    const stats = computeStats(segments, { eleThreshold: 6 });
    meta = {
      id: r.id, kind: 'ride', name: name.trim() || defaultName(r.startedAt), notes: '',
      date: new Date(r.startedAt).toISOString(), stats, preview: previewOf(segments), followId: r.followId,
    };
    await saveItem(meta, { segments });
  } else {
    await deleteItem(r.id).catch(() => {}); // retire aussi les photos prises pendant la balade
  }
  Object.assign(rec, blank());
  await kv.del('recording').catch(() => {});
  emit('rec-state', rec);
  return meta;
}

/** Une balade interrompue (appli fermée, téléphone redémarré) attend-elle d'être reprise ? */
export async function pendingRecording() {
  const saved = await kv.get('recording');
  return saved && saved.state && saved.segments ? saved : null;
}

export function resumeFrom(saved) {
  Object.assign(rec, blank(), saved, { state: 'recording' });
  if (rec.segments.at(-1)?.length) rec.segments.push([]);
  unsub?.();
  unsub = subscribe(onPos);
  keepAwake(true);
  persist();
  emit('rec-state', rec);
}

export async function finishSaved(saved, { discard = false } = {}) {
  Object.assign(rec, blank(), saved, { state: 'paused' });
  return stop({ discard });
}
