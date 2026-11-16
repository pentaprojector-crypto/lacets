// Planificateur : étapes sur la carte, itinéraire moto Valhalla, options, profil, sauvegarde et export GPX.
import { app, emit } from './state.js';
import {
  h, icon, clear, toast, Sheet, segmented, switchRow, debounce, fmtKm, fmtDur, fmtEle, kmValue,
  confirmBox, actionSheet, promptBox, uid, downloadBlob, safeFilename, fmtDate,
} from './ui.js';
import { setData, clearData, addMarker, fitBounds, flyTo, fc, lineFeature, multiLine } from './mapview.js';
import { routeValhalla, routeOsrm, PROFILES, routingErrorText, reverseName, elevations } from './services.js';
import { dist, cumulative, sampleAlong, computeStats, previewOf, projectOnLine, bboxOf, flatten } from './geo.js';
import { Profile } from './profile.js';
import { saveItem, getItem, getGeom, kv } from './db.js';
import { toGpx } from './gpx.js';
import * as loc from './location.js';

const MAX_POINTS_PER_REQUEST = 20;
const DEFAULT_OPTIONS = { profile: 'balade', avoidHighways: false, avoidTolls: false, avoidFerries: false, avoidUnpaved: true, mode: 'route' };

const state = {
  id: null, name: '', notes: '',
  wps: [],
  options: { ...DEFAULT_OPTIONS },
  legs: new Map(),
  elev: null, elevLoading: false,
  busy: false, error: null, engineNote: null,
  undo: [], redo: [],
  dirty: false,
  reference: null,
};

let sheet, ui = {}, markers = [], profile, hoverMarker = null;
let computing = false, again = false;
let visible = false;

/* ---------- clés et étapes ---------- */
const optionsKey = () => {
  const o = state.options;
  return o.mode === 'straight' ? 'straight' : [o.profile, +o.avoidHighways, +o.avoidTolls, +o.avoidFerries, +o.avoidUnpaved].join('');
};
const legKey = (a, b) => `${a.lon.toFixed(6)},${a.lat.toFixed(6)}>${b.lon.toFixed(6)},${b.lat.toFixed(6)}|${optionsKey()}`;

function currentLegs() {
  const out = [];
  for (let i = 0; i < state.wps.length - 1; i++) {
    const leg = state.legs.get(legKey(state.wps[i], state.wps[i + 1]));
    if (!leg) return null;
    out.push(leg);
  }
  return out;
}

function joinLegs(legs) {
  const coords = [], maneuvers = [];
  let length = 0, time = 0;
  legs.forEach((leg, j) => {
    const start = coords.length ? coords.length - 1 : 0;
    coords.push(...(coords.length ? leg.coords.slice(1) : leg.coords));
    for (const m of leg.maneuvers || []) {
      const isStart = m.type >= 1 && m.type <= 3, isDest = m.type >= 4 && m.type <= 6;
      if ((isStart && j > 0) || (isDest && j < legs.length - 1)) continue;
      maneuvers.push({ ...m, i: start + m.i });
    }
    length += leg.length; time += leg.time;
  });
  return { coords, maneuvers, length, time };
}

function straightLeg(a, b) {
  const d = dist([a.lon, a.lat], [b.lon, b.lat]);
  return { coords: [[a.lon, a.lat], [b.lon, b.lat]], length: d, time: d / (50 / 3.6), maneuvers: [], engine: 'straight' };
}

const isLoop = () => state.wps.length > 2 && dist([state.wps[0].lon, state.wps[0].lat], [state.wps.at(-1).lon, state.wps.at(-1).lat]) < 150;
const shortName = (wp) => (wp?.name || '').split(',')[0].trim();
function autoName() {
  const w = state.wps;
  if (w.length < 2) return 'Nouveau parcours';
  const a = shortName(w[0]), b = shortName(w.at(-1));
  if (isLoop()) return a ? `Boucle depuis ${a}` : 'Boucle moto';
  if (a && b && a !== b) return `${a} → ${b}`;
  return `Parcours du ${fmtDate(Date.now())}`;
}

/* ---------- calcul d'itinéraire ---------- */
async function computeRoute() {
  if (computing) { again = true; return; }
  computing = true;
  try {
    do { again = false; await computeOnce(); } while (again);
  } finally {
    computing = false;
    state.busy = false;
    afterRoute();
  }
}

async function computeOnce() {
  const wps = state.wps.slice();
  if (wps.length < 2) return;
  const needed = [];
  for (let i = 0; i < wps.length - 1; i++) if (!state.legs.has(legKey(wps[i], wps[i + 1]))) needed.push(i);
  if (!needed.length) return;
  if (state.options.mode === 'straight') {
    for (const i of needed) state.legs.set(legKey(wps[i], wps[i + 1]), straightLeg(wps[i], wps[i + 1]));
    return;
  }
  const runs = [];
  for (const i of needed) {
    const r = runs.at(-1);
    if (r && r.end === i && r.end - r.start + 1 < MAX_POINTS_PER_REQUEST) r.end = i + 1;
    else runs.push({ start: i, end: i + 1 });
  }
  state.busy = true; state.error = null;
  renderHead();
  for (const r of runs) {
    const pts = wps.slice(r.start, r.end + 1);
    let res;
    try {
      res = await routeValhalla(pts, state.options);
      state.engineNote = null;
    } catch (e) {
      if (e.offline || (e.status && e.status < 500)) { state.error = routingErrorText(e); renderHead(); continue; }
      try {
        res = await routeOsrm(pts);
        state.engineNote = 'Valhalla ne répond pas : itinéraire de secours (voiture, sans options moto).';
      } catch (e2) { state.error = routingErrorText(e2); renderHead(); continue; }
    }
    res.legs.forEach((leg, j) => {
      const i = r.start + j;
      if (i + 1 < wps.length) state.legs.set(legKey(wps[i], wps[i + 1]), { ...leg, engine: res.engine });
    });
    drawRoute();
  }
  if (state.legs.size > 400) {
    const keep = new Set();
    for (let i = 0; i < state.wps.length - 1; i++) keep.add(legKey(state.wps[i], state.wps[i + 1]));
    for (const k of [...state.legs.keys()]) if (!keep.has(k)) state.legs.delete(k);
  }
}

function afterRoute() {
  drawRoute();
  renderHead();
  scheduleElevation();
}

const scheduleElevation = debounce(async () => {
  const legs = currentLegs();
  if (!legs || !legs.length) { renderProfile(); return; }
  const { coords } = joinLegs(legs);
  if (coords.length < 2) return;
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  const key = `${coords.length}|${Math.round(total)}|${coords[0].join()}|${coords.at(-1).join()}`;
  if (state.elev?.key === key) return;
  const n = Math.max(20, Math.min(300, Math.round(total / 250)));
  const samples = sampleAlong(coords, cum, n);
  state.elevLoading = true;
  renderProfile();
  try {
    const es = await elevations(samples);
    const pts = samples.map((s, i) => ({ d: s[2], e: es[i], lon: s[0], lat: s[1] })).filter((p) => Number.isFinite(p.e));
    const st = computeStats([pts.map((p) => [p.lon, p.lat, p.e, null])], { eleThreshold: 3 });
    state.elev = { key, pts, gain: st.gain, loss: st.loss };
  } catch (e) {
    state.elev = { key, pts: [], error: e.offline ? 'Altitude indisponible hors connexion' : 'Altitude indisponible pour le moment' };
  } finally {
    state.elevLoading = false;
    renderProfile();
    renderHead();
  }
}, 1200);

function elevationValid() {
  const legs = currentLegs();
  if (!legs || !state.elev?.pts?.length) return false;
  const { coords } = joinLegs(legs);
  const cum = cumulative(coords);
  return state.elev.key === `${coords.length}|${Math.round(cum[cum.length - 1])}|${coords[0].join()}|${coords.at(-1).join()}`;
}

function withElevation(coords) {
  const pts = elevationValid() ? state.elev.pts : null;
  if (!pts) return coords.map((c) => [c[0], c[1], null, null]);
  const cum = cumulative(coords);
  let j = 0;
  return coords.map((c, i) => {
    const d = cum[i];
    while (j < pts.length - 2 && pts[j + 1].d < d) j++;
    const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
    const t = b.d > a.d ? Math.max(0, Math.min(1, (d - a.d) / (b.d - a.d))) : 0;
    return [c[0], c[1], Math.round((a.e + (b.e - a.e) * t) * 10) / 10, null];
  });
}

/* ---------- carte ---------- */
function drawRoute() {
  if (!visible) return;
  const feats = [];
  for (let i = 0; i < state.wps.length - 1; i++) {
    const a = state.wps[i], b = state.wps[i + 1];
    const leg = state.legs.get(legKey(a, b));
    feats.push(leg ? lineFeature(leg.coords, { leg: i }) : lineFeature([[a.lon, a.lat], [b.lon, b.lat]], { leg: i, pending: true }));
  }
  setData('ov-plan', fc(feats));
}

function renderMarkers() {
  markers.forEach((m) => m.remove());
  markers = [];
  if (!visible) return;
  const n = state.wps.length;
  state.wps.forEach((wp, i) => {
    const label = i === 0 ? 'D' : i === n - 1 ? 'A' : String(i);
    const el = h('div', { class: 'mk-wp' + (i === 0 ? ' start' : i === n - 1 ? ' end' : ''), role: 'button', tabindex: '0', 'aria-label': `${i === 0 ? 'Départ' : i === n - 1 ? 'Arrivée' : 'Étape ' + i} : ${wp.name || 'point'}` }, label);
    const m = addMarker(el, [wp.lon, wp.lat], { draggable: true });
    let dragged = 0;
    m.on('dragstart', () => { pushUndo(); });
    m.on('drag', () => { const ll = m.getLngLat(); wp.lon = ll.lng; wp.lat = ll.lat; drawRoute(); });
    m.on('dragend', () => { dragged = Date.now(); wp.name = ''; nameWaypoint(wp); changed(); });
    el.addEventListener('click', (e) => { e.stopPropagation(); if (Date.now() - dragged > 400) waypointMenu(wp); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') waypointMenu(wp); });
    markers.push(m);
  });
}

function drawReference() {
  if (!visible) return;
  if (state.reference) setData('ov-sel', multiLine(state.reference.segments, { kind: state.reference.kind }));
  else clearData('ov-sel');
}

/* ---------- modifications ---------- */
function snapshot() { return JSON.stringify(state.wps.map(({ id, lon, lat, name }) => ({ id, lon, lat, name }))); }
function pushUndo() {
  state.undo.push(snapshot());
  if (state.undo.length > 60) state.undo.shift();
  state.redo = [];
}
function restore(snap) { state.wps = JSON.parse(snap); changed(); }

function changed() {
  state.dirty = true;
  if (state.wps.length < 2) state.error = null;
  renderAll();
  computeRoute();
  saveDraft();
}

function addWaypoint(lon, lat, { index = state.wps.length, name = '' } = {}) {
  pushUndo();
  const wp = { id: uid(), lon, lat, name };
  state.wps.splice(index, 0, wp);
  if (!name) nameWaypoint(wp);
  changed();
  return wp;
}

async function nameWaypoint(wp) {
  const k = `${wp.lon.toFixed(5)},${wp.lat.toFixed(5)}`;
  wp._k = k;
  const name = await reverseName(wp.lon, wp.lat);
  if (wp._k !== k || !state.wps.includes(wp)) return;
  wp.name = name || `${wp.lat.toFixed(4)}, ${wp.lon.toFixed(4)}`;
  renderWps();
  renderHead();
  saveDraft();
}

async function waypointMenu(wp) {
  const i = state.wps.indexOf(wp);
  if (i < 0) return;
  const n = state.wps.length;
  const choice = await actionSheet(wp.name || 'Point de passage', [
    { key: 'rename', label: 'Renommer', icon: 'edit' },
    i > 0 ? { key: 'start', label: 'En faire le départ', icon: 'flag' } : null,
    i < n - 1 ? { key: 'end', label: 'En faire l’arrivée', icon: 'flag' } : null,
    { key: 'delete', label: 'Supprimer ce point', icon: 'trash', danger: true },
  ]);
  if (!choice) return;
  if (choice === 'delete') { pushUndo(); state.wps.splice(i, 1); changed(); }
  if (choice === 'start') { pushUndo(); state.wps.splice(i, 1); state.wps.unshift(wp); changed(); }
  if (choice === 'end') { pushUndo(); state.wps.splice(i, 1); state.wps.push(wp); changed(); }
  if (choice === 'rename') {
    const v = await promptBox({ title: 'Nom du point', value: wp.name, ok: 'Renommer' });
    if (v != null) { wp.name = v; renderWps(); saveDraft(); }
  }
}

/* ---------- interface ---------- */
function build(root) {
  sheet = new Sheet({ peek: 182, half: 0.52, full: 0.93, initial: 'half', onSnap: () => emit('insets-changed') });
  root.append(sheet.el);

  ui.name = h('input', { class: 'name-input', id: 'plan-name', placeholder: 'Nouveau parcours', 'aria-label': 'Nom du parcours', enterkeyhint: 'done' });
  ui.name.addEventListener('input', () => { state.name = ui.name.value; state.dirty = true; saveDraft(); });
  ui.more = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Plus d’actions' }, icon('more'));
  ui.more.onclick = moreMenu;
  ui.summary = h('div', { class: 'summary-line', 'aria-live': 'polite' });
  ui.status = h('div', { class: 'status' });
  ui.save = h('button', { class: 'btn btn-primary', type: 'button' }, icon('check'), 'Enregistrer');
  ui.export = h('button', { class: 'btn compact', type: 'button', 'aria-label': 'Exporter en GPX' }, icon('download'), 'GPX');
  ui.ride = h('button', { class: 'btn btn-dark', type: 'button' }, icon('nav'), 'Rouler');
  ui.save.onclick = () => save();
  ui.export.onclick = exportGpx;
  ui.ride.onclick = rideIt;
  sheet.head.append(
    h('div', { class: 'sheet-title-row' }, ui.name, ui.more),
    ui.summary, ui.status,
    h('div', { class: 'btn-row', style: { marginTop: '10px' } }, ui.save, ui.export, ui.ride),
  );

  const tool = (ic, label, fn) => { const b = h('button', { class: 'tool', type: 'button' }, icon(ic), label); b.onclick = fn; return b; };
  ui.tools = {
    me: tool('locate', 'Ma position', addMyPosition),
    undo: tool('undo', 'Annuler', () => { if (state.undo.length) { state.redo.push(snapshot()); restore(state.undo.pop()); } }),
    redo: tool('redo', 'Rétablir', () => { if (state.redo.length) { state.undo.push(snapshot()); restore(state.redo.pop()); } }),
    reverse: tool('swap', 'Inverser', () => { pushUndo(); state.wps.reverse(); changed(); }),
    loop: tool('loop', 'Boucle', toggleLoop),
    clear: tool('trash', 'Effacer', clearAll),
  };

  ui.profileSeg = segmented(Object.entries(PROFILES).map(([k, p]) => [k, p.label]), state.options.profile, (v) => setOption('profile', v), { label: 'Type de route' });
  ui.profileHint = h('p', { class: 'hint' });
  ui.switches = h('div', { class: 'switches' },
    switchRow('opt-hw', 'Éviter les autoroutes', state.options.avoidHighways, (v) => setOption('avoidHighways', v)),
    switchRow('opt-toll', 'Éviter les péages', state.options.avoidTolls, (v) => setOption('avoidTolls', v)),
    switchRow('opt-unpaved', 'Éviter les chemins non goudronnés', state.options.avoidUnpaved, (v) => setOption('avoidUnpaved', v)),
    switchRow('opt-ferry', 'Éviter les bacs et ferries', state.options.avoidFerries, (v) => setOption('avoidFerries', v)));
  ui.modeSeg = segmented([['route', 'Suivre les routes'], ['straight', 'Ligne droite']], state.options.mode, (v) => setOption('mode', v), { label: 'Tracé' });

  ui.profileBox = h('div');
  profile = new Profile(ui.profileBox, {
    colorVar: '--route',
    onHover: (p) => {
      if (!p) { hoverMarker?.remove(); hoverMarker = null; return; }
      if (!hoverMarker) hoverMarker = addMarker(h('div', { class: 'mk-hover' }), [p.lon, p.lat]);
      hoverMarker.setLngLat([p.lon, p.lat]);
    },
  });
  ui.gain = h('span', { class: 'muted small num' });
  ui.wps = h('div', { class: 'wps' });
  ui.wpsHint = h('p', { class: 'hint' }, 'Touche la carte pour ajouter une étape. Touche le tracé pour y insérer un point, puis fais-le glisser pour modifier l’itinéraire.');

  sheet.body.append(
    h('div', { class: 'tool-row', role: 'toolbar', 'aria-label': 'Outils' }, Object.values(ui.tools)),
    h('section', {}, h('h3', { class: 'section-title' }, 'Type de route'), ui.profileSeg, ui.profileHint, ui.switches),
    h('section', {}, h('h3', { class: 'section-title' }, 'Profil', ui.gain), ui.profileBox),
    h('section', {}, h('h3', { class: 'section-title' }, 'Étapes'), ui.wps, ui.wpsHint),
    h('section', {}, h('h3', { class: 'section-title' }, 'Tracé entre les étapes'), ui.modeSeg,
      h('p', { class: 'hint', style: { marginTop: '6px' } }, 'La ligne droite sert pour un passage hors réseau ou quand tu n’as pas de connexion.')),
  );
}

function setOption(k, v) {
  state.options[k] = v;
  state.dirty = true;
  kv.set('planner-options', { ...state.options, mode: 'route' }).catch(() => {});
  renderAll();
  computeRoute();
  saveDraft();
}

function renderAll() { renderHead(); renderTools(); renderWps(); renderMarkers(); drawRoute(); renderOptions(); }

function renderOptions() {
  ui.profileSeg.setValue(state.options.profile);
  ui.modeSeg.setValue(state.options.mode);
  ui.profileHint.textContent = PROFILES[state.options.profile]?.hint || '';
  const ids = { avoidHighways: 'opt-hw', avoidTolls: 'opt-toll', avoidUnpaved: 'opt-unpaved', avoidFerries: 'opt-ferry' };
  for (const [k, id] of Object.entries(ids)) { const el = document.getElementById(id); if (el) el.checked = !!state.options[k]; }
}

function renderHead() {
  if (!ui.name) return;
  if (document.activeElement !== ui.name) ui.name.value = state.name;
  ui.name.placeholder = autoName();
  clear(ui.summary);
  clear(ui.status);
  const legs = currentLegs();
  const n = state.wps.length;
  if (n < 2) {
    ui.summary.append(h('span', {}, n === 0 ? 'Touche la carte pour placer le départ, ou cherche un lieu.' : 'Ajoute une destination ou un point de passage.'));
  } else if (legs) {
    const j = joinLegs(legs);
    ui.summary.append(h('b', {}, fmtKm(j.length)), h('b', {}, fmtDur(j.time)));
    if (elevationValid()) ui.summary.append(h('b', {}, `D+ ${fmtEle(state.elev.gain)}`));
    ui.summary.append(h('span', {}, `${n} points`));
  } else {
    ui.summary.append(h('span', {}, 'Calcul de l’itinéraire…'));
  }
  if (state.busy) ui.status.append(h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Calcul en cours');
  else if (state.error) ui.status.append(h('span', { class: 'leg-warn' }, state.error));
  else if (state.engineNote) ui.status.append(h('span', { class: 'hint' }, state.engineNote));
  const ready = n >= 2 && !!legs;
  ui.save.disabled = !ready;
  ui.export.disabled = !ready;
  ui.ride.disabled = !ready;
}

function renderTools() {
  if (!ui.tools) return;
  ui.tools.undo.disabled = !state.undo.length;
  ui.tools.redo.disabled = !state.redo.length;
  ui.tools.reverse.disabled = state.wps.length < 2;
  ui.tools.loop.disabled = state.wps.length < 2;
  ui.tools.clear.disabled = !state.wps.length;
  ui.tools.loop.lastChild.textContent = isLoop() ? 'Ouvrir' : 'Boucle';
}

function renderWps() {
  if (!ui.wps) return;
  clear(ui.wps);
  const n = state.wps.length;
  ui.wpsHint.hidden = n > 3;
  state.wps.forEach((wp, i) => {
    const up = h('button', { type: 'button', 'aria-label': 'Monter', disabled: i === 0 }, icon('up'));
    const down = h('button', { type: 'button', 'aria-label': 'Descendre', disabled: i === n - 1 }, icon('down'));
    const del = h('button', { type: 'button', 'aria-label': 'Supprimer' }, icon('close'));
    up.onclick = () => { pushUndo(); [state.wps[i - 1], state.wps[i]] = [state.wps[i], state.wps[i - 1]]; changed(); };
    down.onclick = () => { pushUndo(); [state.wps[i + 1], state.wps[i]] = [state.wps[i], state.wps[i + 1]]; changed(); };
    del.onclick = () => { pushUndo(); state.wps.splice(i, 1); changed(); };
    const badge = h('span', { class: 'wp-badge', style: i === 0 ? { background: '#157347' } : i === n - 1 && n > 1 ? { background: '#16191d' } : null }, i === 0 ? 'D' : i === n - 1 ? 'A' : String(i));
    const nameBtn = h('button', { class: 'wp-name', type: 'button', style: { border: 0, background: 'none', textAlign: 'left', padding: '10px 0', cursor: 'pointer' } }, wp.name || 'Recherche du nom…');
    nameBtn.onclick = () => flyTo([wp.lon, wp.lat], 14);
    ui.wps.append(h('div', { class: 'wp' }, badge, nameBtn, h('div', { class: 'wp-actions' }, up, down, del)));
  });
}

function renderProfile() {
  if (!profile) return;
  if (state.elevLoading) { profile.set([], { message: 'Calcul du profil…' }); ui.gain.textContent = ''; return; }
  if (state.wps.length < 2) { profile.set([], { message: 'Le profil s’affiche une fois l’itinéraire tracé' }); ui.gain.textContent = ''; return; }
  if (elevationValid()) {
    profile.set(state.elev.pts);
    ui.gain.textContent = `D+ ${fmtEle(state.elev.gain)} · D− ${fmtEle(state.elev.loss)}`;
  } else {
    profile.set([], { message: state.elev?.error || 'Profil en attente de l’itinéraire' });
    ui.gain.textContent = '';
  }
}

/* ---------- actions ---------- */
async function addMyPosition() {
  try {
    const p = await loc.once();
    addWaypoint(p.lon, p.lat, { index: 0, name: 'Ma position' });
    flyTo([p.lon, p.lat], 13);
  } catch (e) {
    toast(loc.errorText(e), { error: true });
  }
}

function toggleLoop() {
  pushUndo();
  if (isLoop()) state.wps.pop();
  else state.wps.push({ ...state.wps[0], id: uid() });
  changed();
}

async function clearAll() {
  if (state.wps.length > 2 && !(await confirmBox({ title: 'Effacer le parcours ?', text: 'Toutes les étapes seront retirées. Tu peux annuler ensuite.', ok: 'Effacer', danger: true }))) return;
  pushUndo();
  state.wps = [];
  state.id = null; state.name = ''; state.notes = ''; state.reference = null; state.elev = null; state.error = null; state.engineNote = null;
  clearData('ov-sel');
  changed();
  state.dirty = false;
}

function buildRecord() {
  const legs = currentLegs();
  if (!legs || state.wps.length < 2) return null;
  const j = joinLegs(legs);
  const segments = [withElevation(j.coords)];
  const stats = computeStats(segments, { eleThreshold: 3 });
  if (elevationValid()) { stats.gain = state.elev.gain; stats.loss = state.elev.loss; }
  stats.estTime = j.time;
  const engines = new Set(legs.map((l) => l.engine));
  const meta = {
    id: state.id || uid(), kind: 'plan', name: state.name.trim() || autoName(), notes: state.notes || '',
    waypoints: state.wps.map(({ lon, lat, name }) => ({ lon, lat, name: name || '' })),
    planOptions: { ...state.options }, stats, preview: previewOf(segments), date: null,
    engine: [...engines].join('+'),
  };
  const geom = {
    segments,
    legs: legs.map((l) => ({ coords: l.coords, length: l.length, time: l.time, maneuvers: l.maneuvers || [], engine: l.engine })),
    maneuvers: j.maneuvers,
  };
  return { meta, geom };
}

async function save({ quiet = false } = {}) {
  const rec = buildRecord();
  if (!rec) { toast('Attends la fin du calcul de l’itinéraire.'); return null; }
  const existing = state.id ? await getItem(state.id) : null;
  if (existing) { rec.meta.createdAt = existing.createdAt; rec.meta.notes = existing.notes || ''; }
  await saveItem(rec.meta, rec.geom);
  state.id = rec.meta.id;
  state.name = rec.meta.name;
  state.dirty = false;
  renderHead();
  saveDraft();
  if (!quiet) toast('Parcours enregistré dans tes parcours.', { action: 'Voir', onAction: () => emit('open-item', rec.meta.id) });
  return rec.meta;
}

async function exportGpx() {
  const rec = buildRecord();
  if (!rec) return;
  const gpx = toGpx(rec.meta, rec.geom, { track: true, route: true });
  downloadBlob(new Blob([gpx], { type: 'application/gpx+xml' }), safeFilename(rec.meta.name, 'gpx'));
  toast('GPX téléchargé (trace + étapes).');
}

async function rideIt() {
  const meta = state.dirty || !state.id ? await save({ quiet: true }) : await getItem(state.id);
  if (meta) emit('ride-with', meta.id);
}

async function moreMenu() {
  const choice = await actionSheet('Parcours', [
    { key: 'new', label: 'Nouveau parcours', icon: 'plus' },
    state.id ? { key: 'saveas', label: 'Enregistrer une copie', icon: 'check' } : null,
    { key: 'fit', label: 'Voir tout le parcours', icon: 'map' },
  ]);
  if (choice === 'new') newPlan();
  if (choice === 'saveas') { state.id = null; state.name = `${state.name || autoName()} (copie)`; await save(); }
  if (choice === 'fit') fitAll();
}

async function newPlan() {
  if (state.dirty && state.wps.length >= 2 && !(await confirmBox({ title: 'Commencer un nouveau parcours ?', text: 'Les modifications non enregistrées seront perdues.', ok: 'Nouveau parcours', danger: true }))) return;
  Object.assign(state, { id: null, name: '', notes: '', wps: [], undo: [], redo: [], elev: null, error: null, engineNote: null, dirty: false, reference: null });
  clearData('ov-sel');
  renderAll();
  renderProfile();
  saveDraft();
}

function fitAll() {
  const legs = currentLegs();
  const lines = legs ? legs.map((l) => l.coords) : [state.wps.map((w) => [w.lon, w.lat])];
  const bb = bboxOf(lines);
  if (bb) fitBounds(bb);
}

/* ---------- brouillon ---------- */
const saveDraft = debounce(() => {
  kv.set('planner-draft', {
    id: state.id, name: state.name, notes: state.notes, dirty: state.dirty,
    wps: state.wps.map(({ id, lon, lat, name }) => ({ id, lon, lat, name })), options: state.options,
  }).catch(() => {});
}, 500);

async function loadDraft() {
  const opts = await kv.get('planner-options');
  if (opts) state.options = { ...DEFAULT_OPTIONS, ...opts };
  const d = await kv.get('planner-draft');
  if (!d) return;
  Object.assign(state, { id: d.id, name: d.name || '', notes: d.notes || '', wps: d.wps || [], dirty: !!d.dirty });
  if (d.options) state.options = { ...DEFAULT_OPTIONS, ...d.options };
  if (state.id) {
    const geom = await getGeom(state.id).catch(() => null);
    if (geom?.legs) seedLegs(geom.legs, state.wps);
  }
}

function seedLegs(legs, wps) {
  legs.forEach((leg, i) => { if (wps[i + 1]) state.legs.set(legKey(wps[i], wps[i + 1]), leg); });
}

/* ---------- API du module ---------- */
export const planner = {
  id: 'planifier',
  async mount(root) { build(root); await loadDraft(); renderAll(); },
  show() {
    visible = true;
    document.body.classList.add('has-sheet');
    app.map?.doubleClickZoom.disable();
    if (app.map) app.map.getCanvas().style.cursor = 'crosshair';
    renderAll();
    drawReference();
    renderProfile();
    sheet.apply();
    if (state.wps.length >= 2) computeRoute();
  },
  hide() {
    visible = false;
    document.body.classList.remove('has-sheet');
    app.map?.doubleClickZoom.enable();
    if (app.map) app.map.getCanvas().style.cursor = '';
    markers.forEach((m) => m.remove());
    markers = [];
    hoverMarker?.remove(); hoverMarker = null;
    clearData('ov-plan');
    clearData('ov-sel');
  },
  bottomInset() { return sheet?.visibleHeight || 0; },
  onMapClick(e) {
    if (e.originalEvent?.target?.closest?.('.maplibregl-marker')) return;
    const p = [e.lngLat.lng, e.lngLat.lat];
    if (state.wps.length >= 2) {
      const box = [[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]];
      const hit = app.map.queryRenderedFeatures(box, { layers: ['ov-plan-hit'] })[0];
      if (hit) {
        const legIdx = hit.properties.leg;
        const a = state.wps[legIdx], b = state.wps[legIdx + 1];
        const leg = a && b && state.legs.get(legKey(a, b));
        let q = p;
        if (leg) { const pr = projectOnLine(p, leg.coords, cumulative(leg.coords)); if (pr && pr.dist < 80) q = pr.point; }
        addWaypoint(q[0], q[1], { index: legIdx + 1 });
        toast('Point inséré : fais-le glisser pour modifier l’itinéraire.', { timeout: 2600 });
        return;
      }
    }
    addWaypoint(p[0], p[1]);
  },
  onSearchPick(place) {
    addWaypoint(place.lon, place.lat, { name: [place.name, place.label.split(',').pop()?.trim()].filter(Boolean).join(', ') });
    flyTo([place.lon, place.lat], 12);
  },
  async edit(id) {
    const meta = await getItem(id);
    const geom = await getGeom(id);
    if (!meta) return;
    if (state.dirty && state.wps.length >= 2 && state.id !== id
      && !(await confirmBox({ title: 'Remplacer le parcours en cours ?', text: 'Le parcours en cours de planification n’est pas enregistré.', ok: 'Remplacer', danger: true }))) return false;
    const wps = (meta.waypoints || []).map((w) => ({ id: uid(), lon: w.lon, lat: w.lat, name: w.name || '' }));
    Object.assign(state, {
      id: meta.kind === 'plan' ? meta.id : null,
      name: meta.kind === 'plan' ? meta.name : `${meta.name} (modifié)`,
      notes: meta.notes || '', wps, undo: [], redo: [], elev: null, error: null, engineNote: null, dirty: meta.kind !== 'plan', reference: null,
    });
    if (meta.planOptions) state.options = { ...DEFAULT_OPTIONS, ...meta.planOptions };
    if (geom?.legs) seedLegs(geom.legs, wps);
    saveDraft();
    emit('show-screen', 'planifier');
    setTimeout(() => { fitAll(); }, 60);
    return true;
  },
  /** Reprend un GPX ou une balade pour en faire un parcours modifiable. */
  async fromItem(meta, geom) {
    if (state.dirty && state.wps.length >= 2
      && !(await confirmBox({ title: 'Remplacer le parcours en cours ?', text: 'Le parcours en cours de planification n’est pas enregistré.', ok: 'Remplacer', danger: true }))) return;
    let pts;
    if (meta.waypoints?.length >= 2) {
      pts = meta.waypoints.map((w) => ({ lon: w.lon, lat: w.lat, name: w.name || '' }));
    } else {
      const flat = flatten(geom.segments);
      const cum = cumulative(flat);
      const total = cum[cum.length - 1];
      const n = Math.max(2, Math.min(25, Math.round(total / 6000) + 1));
      pts = sampleAlong(flat, cum, n).map((s) => ({ lon: s[0], lat: s[1], name: '' }));
    }
    const wps = pts.map((p) => ({ id: uid(), ...p }));
    Object.assign(state, {
      id: null, name: `${meta.name} (modifié)`, notes: '', wps, undo: [], redo: [], elev: null, error: null, engineNote: null, dirty: true,
      reference: { segments: geom.segments, kind: meta.kind },
    });
    wps.forEach((w) => { if (!w.name) nameWaypoint(w); });
    saveDraft();
    emit('show-screen', 'planifier');
    setTimeout(() => fitAll(), 60);
    toast(`Itinéraire recalculé à partir de ${wps.length} points : vérifie qu’il suit bien la trace d’origine.`, { timeout: 6000 });
  },
  /** Prépare un trajet de ma position jusqu'à un point (ex. lieu de rendez-vous). */
  async routeTo(lon, lat, name) {
    await newPlan();
    if (state.wps.length) return;
    addWaypoint(lon, lat, { name });
    emit('show-screen', 'planifier');
    try { const p = await loc.once(); addWaypoint(p.lon, p.lat, { index: 0, name: 'Ma position' }); setTimeout(fitAll, 100); }
    catch (e) { toast(loc.errorText(e), { error: true }); }
  },
};
