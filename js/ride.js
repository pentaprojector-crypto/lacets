// Mode Rouler : enregistrement de la balade et guidage le long d'un parcours (consignes vocales en français).
import { app, emit, on } from './state.js';
import {
  h, icon, clear, toast, Sheet, switchRow, fmtKm, fmtDist, fmtClock, fmtSpeed, fmtEle, fmtTime, fmtDate,
  drawSilhouette, openModal, pickFiles, plural,
} from './ui.js';
import { setData, clearData, addMarker, fitBounds, fc, lineFeature, multiLine, colors } from './mapview.js';
import { cumulative, projectOnLine, indexAtDistance, flatten, bearing, angleDiff, dist, pointAt } from './geo.js';
import * as loc from './location.js';
import * as recorder from './recorder.js';
import { getItem, getGeom, kv } from './db.js';
import { getItems, openItem, refreshItems, KIND_LABEL } from './library.js';
import { importPhotos } from './photos.js';
import { routeValhalla } from './services.js';

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/* ---------- consignes ---------- */
const ARROWS = {
  straight: '<path d="M24 42V9"/><path d="M13 19 24 8l11 11"/>',
  slight: '<path d="M19 42V28c0-6 3-10 8-13l7-4"/><path d="M24 9h11v11"/>',
  turn: '<path d="M15 42V25a7 7 0 0 1 7-7h18"/><path d="M31 9l9 9-9 9"/>',
  sharp: '<path d="M17 42V11l20 20"/><path d="M37 19v12H25"/>',
  uturn: '<path d="M32 42V20a8 8 0 0 0-16 0v16"/><path d="M9 29l7 7 7-7"/>',
  round: '<circle cx="24" cy="20" r="7"/><path d="M24 42V27"/><path d="M29 15l7-7"/><path d="M28 8h8v8"/>',
  dest: '<path d="M24 44s-12-10.5-12-20a12 12 0 0 1 24 0c0 9.5-12 20-12 20z"/><circle cx="24" cy="24" r="4"/>',
  start: '<path d="M10 22 38 10 26 38l-3-12z"/>',
  ferry: '<path d="M8 31h32l-5 8H13z"/><path d="M15 31V21h18v10"/><path d="M24 21v-9"/>',
  off: '<path d="M24 40V10"/><path d="M13 21 24 10l11 11"/>',
};
function arrowFor(type) {
  const left = [3, 6, 13, 14, 15, 16, 19, 21, 24, 38].includes(type);
  let key = 'straight';
  if ([9, 16, 18, 19, 20, 21, 23, 24, 37, 38].includes(type)) key = 'slight';
  if ([10, 15].includes(type)) key = 'turn';
  if ([11, 14].includes(type)) key = 'sharp';
  if ([12, 13].includes(type)) key = 'uturn';
  if ([26, 27].includes(type)) key = 'round';
  if ([4, 5, 6].includes(type)) key = 'dest';
  if ([1, 2, 3].includes(type)) key = 'start';
  if ([28, 29].includes(type)) key = 'ferry';
  const flip = left && !['round', 'dest', 'start', 'ferry', 'straight'].includes(key);
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><g${flip ? ' transform="translate(48 0) scale(-1 1)"' : ''}>${ARROWS[key]}</g></svg>`;
}

const ROAD_RE = /\b(RN|RD|[ADNMEC])\s?(\d{1,4}[a-z]?)\b/g;
function withRoads(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(ROAD_RE)) {
    frag.append(text.slice(last, m.index));
    const p = m[1].replace(/^R/, '');
    frag.append(h('span', { class: `road road-${p.toLowerCase()}` }, `${p} ${m[2]}`));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

const speechDist = (m) => (m < 950 ? `${Math.round(m / 50) * 50} mètres` : `${nf1.format(m / 1000)} kilomètres`);
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const noDot = (s) => s.replace(/[.\s]+$/, '');

class Guide {
  constructor(coords, maneuvers = []) {
    this.coords = coords.map((c) => [c[0], c[1]]);
    this.cum = cumulative(this.coords);
    this.total = this.cum[this.cum.length - 1];
    this.mans = maneuvers.map((m) => ({ ...m, along: this.cum[Math.min(m.i, this.cum.length - 1)] }));
    this.along = 0; this.offCount = 0; this.off = false; this.arrived = false;
    this.said = new Set();
  }
  get hasManeuvers() { return this.mans.length > 1; }
  update(p) {
    const P = [p.lon, p.lat];
    const from = indexAtDistance(this.cum, Math.max(0, this.along - 300));
    const to = Math.min(this.coords.length - 1, indexAtDistance(this.cum, this.along + 3000) + 2);
    let pr = projectOnLine(P, this.coords, this.cum, from, to);
    if (!pr || pr.dist > 60) {
      const g = projectOnLine(P, this.coords, this.cum);
      if (g && (!pr || g.dist + 30 < pr.dist)) pr = g;
    }
    const events = [];
    const tol = 45 + Math.min(40, p.acc || 0);
    this.offCount = pr.dist > tol ? this.offCount + 1 : 0;
    const wasOff = this.off;
    this.off = this.offCount >= 3;
    if (!this.off) this.along = pr.along;
    if (this.off && !wasOff) events.push('Vous avez quitté le parcours.');
    if (!this.off && wasOff) events.push('Parcours retrouvé.');
    const remaining = Math.max(0, this.total - this.along);
    const k = this.mans.findIndex((m) => m.along > this.along + 4 && !(m.type >= 1 && m.type <= 3));
    const next = k >= 0 ? this.mans[k] : null;
    const then = k >= 0 ? this.mans[k + 1] : null;
    const dNext = next ? next.along - this.along : null;
    if (!this.off && next && !this.arrived) {
      const v = Math.max(8, p.speed || 0);
      const far = Math.min(1500, Math.max(400, v * 22));
      const near = Math.min(250, Math.max(70, v * 6));
      const key = Math.round(next.along);
      if (next.type >= 4 && next.type <= 6) {
        if (dNext <= 35 && !this.said.has(`${key}a`)) { this.said.add(`${key}a`); this.arrived = true; events.push(next.pre || 'Vous êtes arrivé.'); }
        else if (dNext <= far && dNext > 300 && !this.said.has(`${key}f`)) { this.said.add(`${key}f`); events.push(`Arrivée dans ${speechDist(dNext)}.`); }
      } else if (dNext <= near && !this.said.has(`${key}n`)) {
        this.said.add(`${key}n`); this.said.add(`${key}f`);
        let s = noDot(next.pre || next.text);
        if (then && then.along - next.along < 150 && !(then.type >= 4 && then.type <= 6)) s += `, puis ${lcFirst(noDot(then.alert || then.text))}`;
        events.push(`${s}.`);
      } else if (dNext <= far && dNext > near * 1.6 && !this.said.has(`${key}f`)) {
        this.said.add(`${key}f`);
        events.push(`Dans ${speechDist(dNext)}, ${lcFirst(noDot(next.alert || next.pre || next.text))}.`);
      }
    }
    if (!this.hasManeuvers && !this.arrived && remaining < 40 && this.total > 300) { this.arrived = true; events.push('Vous êtes au bout du parcours.'); }
    return { pr, off: this.off, along: this.along, remaining, next, then, dNext, events };
  }
}

/* ---------- état ---------- */
const ride = {
  active: false, selectedId: null, record: true, voice: true, simulate: false,
  meta: null, guide: null, join: null, camera: 'follow', northUp: false,
  lastPos: null, lastG: null, unsub: null, alertSaid: new Set(), startedAt: 0,
};
let sheet, s = {}, hud, g = {}, motoMarker = null, liveTimer = 0;

/* ---------- voix ---------- */
let frVoice = null;
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  frVoice = voices.find((v) => v.lang === 'fr-FR' && v.localService) || voices.find((v) => v.lang?.startsWith('fr')) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.addEventListener?.('voiceschanged', pickVoice); }
export function speak(text, { force = false } = {}) {
  if ((!ride.voice && !force) || !('speechSynthesis' in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  if (frVoice) u.voice = frVoice;
  u.rate = 1.03;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* ---------- préparation ---------- */
function buildSetup(root) {
  sheet = new Sheet({ peek: 200, half: 0.6, full: 0.93, initial: 'half', onSnap: () => emit('insets-changed') });
  root.append(sheet.el);
  s.title = h('h2', {}, 'Rouler');
  s.sub = h('p', { class: 'muted small' });
  s.start = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button' }, icon('play'), 'Démarrer');
  s.start.onclick = () => startRide();
  sheet.head.append(s.title, s.sub, h('div', { style: { marginTop: '10px' } }, s.start));
  s.rec = switchRow('ride-rec', 'Enregistrer la balade', ride.record, (v) => { ride.record = v; renderSetup(); }, 'Trace, statistiques et photos rangées dans tes parcours');
  s.voice = switchRow('ride-voice', 'Guidage vocal', ride.voice, (v) => { ride.voice = v; app.settings.voice = v; emit('settings-changed'); }, 'Passe dans ton intercom si le téléphone y est appairé');
  s.list = h('div', { class: 'route-pick', role: 'listbox', 'aria-label': 'Parcours à suivre' });
  s.sim = h('button', { class: 'btn btn-block', type: 'button' }, icon('sim'), 'Simuler le trajet (tester le guidage)');
  s.sim.onclick = () => startRide({ simulate: true });
  sheet.body.append(
    h('div', { class: 'switches' }, s.rec, s.voice),
    h('section', {}, h('h3', { class: 'section-title' }, 'Parcours à suivre'), s.list),
    s.sim,
    h('p', { class: 'hint' }, 'Garde l’écran allumé et Lacets au premier plan pendant la balade : le navigateur coupe le GPS des applis en arrière-plan.'));
}

async function renderSetup() {
  if (!s.list) return;
  const items = getItems().filter((m) => m.stats?.distance > 0);
  clear(s.list);
  const choose = (id) => { ride.selectedId = id; renderSetup(); showSelected(true); };
  const free = h('button', { class: 'row', type: 'button', role: 'option', 'aria-pressed': String(!ride.selectedId) },
    h('span', { class: 'thumb', style: { display: 'grid', placeItems: 'center' } }, icon('moto')),
    h('span', { class: 'row-main' }, h('b', {}, 'Balade libre'), h('span', { class: 'row-meta' }, 'Sans parcours, juste l’enregistrement')), h('span'));
  free.onclick = () => choose(null);
  s.list.append(free);
  const c = colors();
  for (const m of items.slice(0, 30)) {
    const canvas = h('canvas', { class: 'thumb', 'aria-hidden': 'true' });
    const row = h('button', { class: `row k-${m.kind}`, type: 'button', role: 'option', 'aria-pressed': String(ride.selectedId === m.id) }, canvas,
      h('span', { class: 'row-main' }, h('b', {}, m.name), h('span', { class: 'row-meta' }, h('span', {}, KIND_LABEL[m.kind]), h('span', { class: 'num' }, fmtKm(m.stats.distance)))), h('span'));
    row.onclick = () => choose(m.id);
    s.list.append(row);
    drawSilhouette(canvas, m.preview, c[m.kind] || c.ink);
  }
  const sel = items.find((m) => m.id === ride.selectedId);
  if (ride.selectedId && !sel) {
    // la liste n'est peut-être pas encore à jour : on ne retire la sélection que si le parcours n'existe plus
    const id = ride.selectedId;
    getItem(id).then((m) => { if (!m && ride.selectedId === id) { ride.selectedId = null; renderSetup(); } });
  }
  s.title.textContent = sel ? sel.name : 'Balade libre';
  s.sub.textContent = sel ? `${KIND_LABEL[sel.kind]} · ${fmtKm(sel.stats.distance)}${sel.stats.gain ? ` · D+ ${fmtEle(sel.stats.gain)}` : ''}` : 'Enregistre ta balade sans suivre de parcours.';
  clear(s.start).append(icon('play'), sel ? (ride.record ? 'Démarrer le guidage et l’enregistrement' : 'Démarrer le guidage') : 'Démarrer l’enregistrement');
  s.start.disabled = !sel && !ride.record;
  s.sim.hidden = !sel;
}

async function showSelected(fit) {
  clearData('ov-sel');
  if (!ride.selectedId) return;
  const meta = await getItem(ride.selectedId);
  const geom = await getGeom(ride.selectedId);
  if (!meta || !geom || ride.active) return;
  setData('ov-sel', multiLine(geom.segments, { kind: meta.kind }));
  if (fit) fitBounds(meta.stats?.bbox);
}

/* ---------- tableau de bord ---------- */
function buildHud(root) {
  g.arrow = h('div', { class: 'g-arrow' });
  g.dist = h('div', { class: 'g-dist' });
  g.text = h('div', { class: 'g-text' });
  g.then = h('div', { class: 'g-then' });
  g.join = h('button', { class: 'btn', type: 'button', style: { gridColumn: '1 / -1', minHeight: '44px' } }, 'Itinéraire pour rejoindre le tracé');
  g.join.onclick = joinRoute;
  g.banner = h('div', { class: 'guidance', role: 'status', 'aria-live': 'polite' }, g.arrow, g.dist, g.text, g.then, g.join);
  g.gps = h('div', { class: 'gps-weak', role: 'status' });
  g.voiceBtn = h('button', { class: 'fab', type: 'button', 'aria-label': 'Couper la voix' }, icon('volume'));
  g.voiceBtn.onclick = () => { ride.voice = !ride.voice; app.settings.voice = ride.voice; emit('settings-changed'); if (ride.voice) speak('Guidage vocal activé.'); else speechSynthesis?.cancel(); renderHudButtons(); };
  g.orientBtn = h('button', { class: 'fab', type: 'button', 'aria-label': 'Carte orientée nord' }, icon('north'));
  g.orientBtn.onclick = () => { ride.northUp = !ride.northUp; ride.camera = 'follow'; renderHudButtons(); if (ride.lastPos) camera(ride.lastPos, true); };
  g.center = h('button', { class: 'fab on', type: 'button', 'aria-label': 'Recentrer sur ma position' }, icon('locate'));
  g.center.onclick = () => { ride.camera = 'follow'; renderHudButtons(); if (ride.lastPos) camera(ride.lastPos, true); };
  g.min = h('button', { class: 'fab', type: 'button', 'aria-label': 'Réduire (la balade continue)' }, icon('down'));
  g.min.onclick = () => emit('show-screen', 'carte');
  g.side = h('div', { class: 'hud-side' }, g.voiceBtn, g.orientBtn, g.center, g.min);

  g.speed = h('div', { class: 'speed', 'aria-label': 'Vitesse' });
  g.stats = h('div', { class: 'dash-stats' });
  const btn = (ic, label, fn, cls = '') => { const b = h('button', { class: `btn ${cls}`, type: 'button' }, icon(ic), h('span', {}, label)); b.onclick = fn; return b; };
  g.pause = btn('pause', 'Pause', togglePause);
  g.photo = btn('camera', 'Photo', takePhoto);
  g.alert = btn('warn', 'Alerte', () => emit('quick-alert', ride.lastPos));
  g.stop = btn('stop', 'Terminer', endRide, 'btn-danger');
  g.dash = h('div', { class: 'dash' }, h('div', { class: 'dash-top' }, g.speed, g.stats), h('div', { class: 'dash-ctrl' }, g.pause, g.photo, g.alert, g.stop));
  hud = h('div', { class: 'ride-hud', hidden: true }, g.banner, g.gps, g.side, g.dash);
  root.append(hud);
  app.map.on('dragstart', (e) => { if (ride.active && e.originalEvent) { ride.camera = 'free'; renderHudButtons(); } });
  app.map.on('rotatestart', (e) => { if (ride.active && e.originalEvent) { ride.camera = 'free'; renderHudButtons(); } });
}

function layoutHud() {
  const top = g.banner.hidden ? 12 : g.banner.offsetTop + g.banner.offsetHeight + 10;
  g.side.style.top = `${top}px`;
  g.gps.style.top = `${top}px`;
}

function renderHudButtons() {
  clear(g.voiceBtn).append(icon(ride.voice ? 'volume' : 'mute'));
  g.voiceBtn.setAttribute('aria-label', ride.voice ? 'Couper la voix' : 'Activer la voix');
  g.orientBtn.classList.toggle('on', ride.northUp);
  g.orientBtn.setAttribute('aria-label', ride.northUp ? 'Carte dans le sens de la marche' : 'Carte orientée nord');
  g.center.hidden = ride.camera === 'follow';
  const r = recorder.recording();
  g.pause.hidden = !recorder.isActive();
  g.photo.hidden = !recorder.isActive();
  clear(g.pause).append(icon(r.state === 'paused' ? 'play' : 'pause'), h('span', {}, r.state === 'paused' ? 'Reprendre' : 'Pause'));
  g.dash.querySelector('.dash-ctrl').style.gridTemplateColumns = `repeat(${recorder.isActive() ? 4 : 2}, 1fr)`;
}

function statBox(v, label) { return h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, label)); }

function renderDash() {
  const p = ride.lastPos;
  const r = recorder.recording();
  const kmh = p?.speed != null ? p.speed * 3.6 : r.speed;
  clear(g.speed).append(fmtSpeed(kmh != null && kmh < 3 ? 0 : kmh), h('small', {}, 'km/h'));
  clear(g.stats);
  const G = ride.lastG;
  if (recorder.isActive()) {
    g.stats.append(statBox(fmtKm(r.dist), 'Parcouru'), statBox(fmtClock(recorder.elapsed()), r.state === 'paused' ? 'En pause' : 'Durée'));
  } else {
    g.stats.append(statBox(fmtClock((Date.now() - ride.startedAt) / 1000), 'Durée'));
  }
  if (ride.guide && G) {
    g.stats.append(statBox(fmtKm(G.remaining), 'Restant'));
    if (!recorder.isActive()) {
      const est = ride.meta?.stats?.estTime && ride.guide.total ? (G.remaining / ride.guide.total) * ride.meta.stats.estTime : G.remaining / (60 / 3.6);
      g.stats.append(statBox(fmtTime(Date.now() + est * 1000), 'Arrivée'));
    }
  } else {
    g.stats.append(statBox(fmtEle(p?.alt), 'Altitude'));
  }
}

function renderBanner() {
  const G = ride.join?.lastG || ride.lastG;
  const guide = ride.join?.guide || ride.guide;
  if (!guide) { g.banner.hidden = true; layoutHud(); return; }
  g.banner.hidden = false;
  g.join.hidden = true;
  clear(g.then); g.then.hidden = true;
  if (!G) {
    g.banner.className = 'guidance free';
    g.arrow.innerHTML = ARROWS.start ? `<svg viewBox="0 0 48 48">${ARROWS.start}</svg>` : '';
    g.dist.textContent = 'GPS…';
    clear(g.text).append('En attente de ta position');
  } else if (ride.guide && G.off && !ride.join) {
    g.banner.className = 'guidance off';
    const hd = ride.lastPos?.heading ?? (ride.northUp ? 0 : app.map.getBearing());
    const rel = angleDiff(hd, bearing([ride.lastPos.lon, ride.lastPos.lat], G.pr.point));
    g.arrow.innerHTML = `<svg viewBox="0 0 48 48" style="transform:rotate(${rel}deg)">${ARROWS.off}</svg>`;
    g.dist.textContent = fmtDist(G.pr.dist);
    clear(g.text).append('Hors parcours : le tracé est par là');
    g.join.hidden = false;
  } else if (G.next) {
    g.banner.className = 'guidance';
    g.arrow.innerHTML = arrowFor(G.next.type);
    g.dist.textContent = fmtDist(G.dNext);
    clear(g.text).append(withRoads(noDot(G.next.text)));
    if (G.then && G.then.along - G.next.along < 400) {
      g.then.hidden = false;
      g.then.append('Puis', h('span', { html: arrowFor(G.then.type), style: { width: '22px', height: '22px', display: 'inline-block' } }), withRoads(noDot(G.then.text)));
      const svg = g.then.querySelector('svg');
      if (svg) { svg.style.width = '22px'; svg.style.height = '22px'; }
    }
  } else {
    g.banner.className = 'guidance free';
    g.arrow.innerHTML = `<svg viewBox="0 0 48 48">${ARROWS.straight}</svg>`;
    g.dist.textContent = fmtKm(G.remaining);
    clear(g.text).append(guide.hasManeuvers ? 'Jusqu’à l’arrivée' : 'Suis le tracé jusqu’à l’arrivée');
  }
  layoutHud();
}

function renderGps() {
  const p = ride.lastPos;
  const stale = !p || Date.now() - p.t > 12000;
  g.gps.hidden = !(stale || p.acc > 40);
  g.gps.textContent = !p ? 'Recherche du signal GPS…' : stale ? 'Signal GPS perdu' : `GPS imprécis (±${Math.round(p.acc)} m)`;
}

/* ---------- carte en mouvement ---------- */
function camera(p, force = false) {
  if (ride.camera !== 'follow' && !force) return;
  const v = p.speed ?? 0;
  const zoom = v > 25 ? 15.2 : v > 14 ? 15.8 : 16.4;
  const H = app.map.getContainer().clientHeight;
  const dashH = g.dash.offsetHeight || 200;
  const bearingTo = ride.northUp ? 0 : p.heading != null && v > 1.5 ? p.heading : app.map.getBearing();
  app.map.easeTo({
    center: [p.lon, p.lat], zoom, bearing: bearingTo, pitch: ride.northUp ? 0 : 45,
    offset: [0, Math.max(0, H * 0.18 - dashH / 4)], duration: force ? 600 : 950, easing: (t) => t,
  });
}

function moveMoto(p) {
  if (!motoMarker) {
    const el = h('div', { class: 'mk-moto', html: '<svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="17" fill="#1a73e8" stroke="#fff" stroke-width="3"/><path d="M23 11 31 31 23 26 15 31z" fill="#fff"/></svg>' });
    motoMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([p.lon, p.lat]).addTo(app.map);
  }
  motoMarker.setLngLat([p.lon, p.lat]);
  if (p.heading != null && (p.speed ?? 0) > 1) motoMarker.setRotation(p.heading);
}

function drawFollow(G) {
  const gd = ride.guide;
  if (!gd || !G || G.off) return;
  const i = G.pr.i;
  const done = [...gd.coords.slice(0, i + 1), G.pr.point];
  const ahead = [G.pr.point, ...gd.coords.slice(i + 1)];
  setData('ov-follow', fc([done.length > 1 ? lineFeature(done, { part: 'done' }) : null, ahead.length > 1 ? lineFeature(ahead, { part: 'ahead' }) : null]));
}

function checkAlerts(p) {
  if ((p.speed ?? 0) < 2) return;
  for (const a of app.activeAlerts?.() || []) {
    if (ride.alertSaid.has(a.id)) continue;
    const d = dist([p.lon, p.lat], [a.lon, a.lat]);
    if (d < 450) {
      ride.alertSaid.add(a.id);
      const label = (app.alertLabel?.(a.kind) || 'Danger').toLowerCase();
      speak(`Attention, ${label} signalé à ${speechDist(Math.max(50, d))}.`);
      toast(`⚠ ${app.alertLabel?.(a.kind) || 'Danger'} à ${fmtDist(d)}${a.note ? ' : ' + a.note : ''}`, { timeout: 7000 });
    }
  }
}

function onPos(p) {
  ride.lastPos = p;
  moveMoto(p);
  if (ride.guide) {
    const G = ride.guide.update(p);
    ride.lastG = G;
    if (ride.join) {
      const J = ride.join.guide.update(p);
      ride.join.lastG = J;
      if (G.pr.dist < 35 || J.arrived) { ride.join = null; clearData('ov-join'); speak('Vous êtes de retour sur le parcours.'); }
      else J.events.forEach((e) => { if (!/^Vous êtes au bout/.test(e)) speak(e); });
    } else {
      G.events.forEach((e) => speak(e));
    }
    drawFollow(G);
  }
  checkAlerts(p);
  camera(p);
  renderBanner();
  renderDash();
  renderGps();
}

async function joinRoute() {
  const p = ride.lastPos;
  const G = ride.lastG;
  if (!p || !G) return;
  g.join.disabled = true;
  try {
    const target = pointAt(ride.guide.coords, ride.guide.cum, Math.min(ride.guide.total, G.pr.along + 400));
    const opts = (await kv.get('planner-options')) || { profile: 'balade', avoidUnpaved: true };
    const res = await routeValhalla([{ lon: p.lon, lat: p.lat }, { lon: target[0], lat: target[1] }], opts);
    const leg = res.legs[0];
    ride.join = { guide: new Guide(leg.coords, leg.maneuvers), lastG: null };
    setData('ov-join', lineFeature(leg.coords));
    speak('Itinéraire pour rejoindre le parcours.');
    if (ride.lastPos) onPos(ride.lastPos);
  } catch (e) {
    toast(e.offline ? 'Hors connexion : rejoins le tracé en suivant la flèche.' : 'Calcul impossible pour le moment.', { error: true });
  } finally {
    g.join.disabled = false;
  }
}

/* ---------- démarrage / fin ---------- */
async function startRide({ simulate = false } = {}) {
  if (ride.active) return;
  ride.meta = null; ride.guide = null; ride.join = null; ride.lastG = null; ride.lastPos = null;
  ride.simulate = simulate;
  ride.alertSaid = new Set();
  if (ride.selectedId) {
    const meta = await getItem(ride.selectedId);
    const geom = await getGeom(ride.selectedId);
    const coords = flatten(geom?.segments || []);
    if (coords.length < 2) { toast('Ce parcours n’a pas de tracé à suivre.', { error: true }); return; }
    ride.meta = meta;
    ride.guide = new Guide(coords, geom.maneuvers || []);
    setData('ov-follow', lineFeature(coords, { part: 'ahead' }));
  }
  if (!ride.guide && !ride.record) return;
  ride.active = true;
  ride.camera = 'follow';
  ride.startedAt = Date.now();
  clearData('ov-sel');
  const recordNow = ride.record && !simulate;
  if (recordNow) recorder.start({ followId: ride.selectedId });
  else recorder.keepAwake(true);
  ride.unsub = loc.subscribe(onPos);
  if (simulate) loc.startSimulation(ride.guide.coords, 75);
  emit('ride-state', true);
  showHud();
  const first = ride.guide?.mans[0];
  if (ride.guide) speak(first && first.type >= 1 && first.type <= 3 ? first.pre : 'Guidage démarré. Suivez le tracé.');
  if (simulate) toast('Simulation : la position avance toute seule le long du parcours.', { timeout: 5000 });
  ride.tick = setInterval(() => { renderDash(); renderGps(); }, 1000);
}

function showHud() {
  sheet.el.hidden = true;
  hud.hidden = false;
  document.getElementById('tabbar').hidden = true;
  renderHudButtons();
  renderBanner();
  renderDash();
  renderGps();
  app.map.easeTo({ pitch: ride.northUp ? 0 : 45, zoom: Math.max(app.map.getZoom(), 15), duration: 600 });
}

function hideHud() {
  hud.hidden = true;
  sheet.el.hidden = false;
  document.getElementById('tabbar').hidden = false;
}

async function endRide() {
  const recActive = recorder.isActive();
  let choice = 'stop', name = '';
  if (recActive) {
    const r = recorder.recording();
    const res = await openModal((box, done) => {
      const input = h('input', { class: 'input', id: 'ride-name', value: recorder.defaultName(r.startedAt), enterkeyhint: 'done' });
      box.append(
        h('h2', {}, 'Terminer la balade ?'),
        h('p', {}, `${fmtKm(r.dist)} en ${fmtClock(recorder.elapsed())}.`),
        h('label', { class: 'field', for: 'ride-name' }, h('span', {}, 'Nom de la balade'), input),
        h('div', { class: 'action-list' },
          h('button', { class: 'btn btn-primary btn-lg', type: 'button', onClick: () => done({ c: 'save', name: input.value }) }, icon('check'), 'Enregistrer la balade'),
          h('button', { class: 'btn btn-lg', type: 'button', onClick: () => done({ c: 'continue' }) }, 'Continuer à rouler'),
          h('button', { class: 'btn btn-lg btn-ghost', type: 'button', style: { color: 'var(--brake)' }, onClick: () => done({ c: 'discard' }) }, icon('trash'), 'Supprimer la trace')));
    });
    if (!res || res.c === 'continue') return;
    choice = res.c; name = res.name || '';
  }
  clearInterval(ride.tick);
  ride.unsub?.(); ride.unsub = null;
  loc.stopSimulation();
  speechSynthesis?.cancel?.();
  let meta = null;
  if (recActive) meta = await recorder.stop({ name, discard: choice === 'discard' });
  else recorder.keepAwake(false);
  ride.active = false; ride.guide = null; ride.join = null; ride.lastG = null;
  motoMarker?.remove(); motoMarker = null;
  clearData('ov-follow'); clearData('ov-join'); clearData('ov-live');
  app.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  hideHud();
  emit('ride-state', false);
  if (meta) { toast(`« ${meta.name} » enregistrée : ${fmtKm(meta.stats.distance)}.`); openItem(meta.id); }
  else if (recActive && choice === 'discard') toast('Trace supprimée.');
  renderSetup();
}

function togglePause() {
  const r = recorder.recording();
  if (r.state === 'paused') { recorder.resume(); speak('Enregistrement repris.'); }
  else { recorder.pause(); speak('Enregistrement en pause.'); }
  renderHudButtons();
  renderDash();
}

async function takePhoto() {
  const r = recorder.recording();
  if (!recorder.isActive()) return;
  const files = await pickFiles({ accept: 'image/*', capture: 'environment', multiple: false });
  if (!files.length) return;
  const here = ride.lastPos || loc.lastPosition();
  await importPhotos(r.id, files, { here });
  toast('Photo ajoutée à la balade.');
}

/* ---------- module ---------- */
export const rideScreen = {
  id: 'rouler',
  mount(root) {
    ride.voice = app.settings.voice !== false;
    buildSetup(root);
    buildHud(root);
    on('items-loaded', () => renderSetup());
    on('ride-with', async (id) => {
      if (ride.active) { toast('Une balade est déjà en cours.'); emit('show-screen', 'rouler'); return; }
      ride.selectedId = id;
      await refreshItems();
      emit('show-screen', 'rouler');
      renderSetup();
      showSelected(true);
    });
    on('rec-point', ({ rec }) => {
      const now = Date.now();
      if (now - liveTimer > 1000) { liveTimer = now; setData('ov-live', multiLine(rec.segments)); }
    });
    on('rec-state', () => { if (ride.active) { renderHudButtons(); renderDash(); } });
    renderSetup();
  },
  show() {
    if (ride.active) showHud();
    else { hud.hidden = true; sheet.el.hidden = false; document.body.classList.add('has-sheet'); sheet.apply(); renderSetup(); showSelected(true); }
  },
  hide() {
    document.body.classList.remove('has-sheet');
    document.getElementById('tabbar').hidden = false;
    if (!ride.active) clearData('ov-sel');
  },
  bottomInset() { return ride.active ? g.dash.offsetHeight : sheet?.visibleHeight || 0; },
  topInset() { return ride.active && !g.banner.hidden ? g.banner.offsetTop + g.banner.offsetHeight : 0; },
  isActive: () => ride.active,
  /** Reprise d'une balade interrompue : on relance le mode Rouler sans parcours. */
  resumeRecording(saved) {
    recorder.resumeFrom(saved);
    ride.selectedId = saved.followId || null;
    ride.active = true;
    ride.camera = 'follow';
    ride.startedAt = saved.startedAt;
    ride.unsub = loc.subscribe(onPos);
    (async () => {
      if (ride.selectedId) {
        const geom = await getGeom(ride.selectedId).catch(() => null);
        const coords = flatten(geom?.segments || []);
        if (coords.length > 1) { ride.meta = await getItem(ride.selectedId); ride.guide = new Guide(coords, geom.maneuvers || []); }
      }
      setData('ov-live', multiLine(saved.segments));
      emit('ride-state', true);
      emit('show-screen', 'rouler');
      ride.tick = setInterval(() => { renderDash(); renderGps(); }, 1000);
    })();
  },
};
