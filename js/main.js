// Démarrage de Lacets : réglages, carte, écrans, recherche, service worker, reprise d'une balade interrompue.
import { app, emit, on } from './state.js';
import { kv } from './db.js';
import { $, $$, h, icon, toast, debounce, actionSheet, fmtKm, fmtClock, clear } from './ui.js';
import { initMap, showMe, flyTo, addMarker, refreshColors } from './mapview.js';
import { enableTileCache, transformRequest } from './offline.js';
import * as loc from './location.js';
import { searchPlaces } from './services.js';
import { carte } from './carte.js';
import { planner } from './planner.js';
import { library, importFiles } from './library.js';
import { rideScreen } from './ride.js';
import { community } from './community.js';
import { openSettings, openLayers } from './settings.js';
import * as recorder from './recorder.js';

const DEFAULTS = {
  theme: 'auto', basemap: 'routier', voice: true, showAlerts: true,
  view: { center: [4.835, 45.764], zoom: 9 },
};

const saveSettings = debounce(() => kv.set('settings', app.settings).catch(() => {}), 400);

function applyTheme() {
  const pref = app.settings.theme || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  refreshColors();
}

function insets() {
  const s = app.screens[app.screen];
  const tab = $('#tabbar');
  const dock = tab.hidden ? 0 : tab.offsetHeight;
  const topbar = $('#topbar');
  const tb = topbar.hidden ? 0 : topbar.getBoundingClientRect().bottom;
  const panel = s?.bottomInset?.() || 0;
  if (window.innerWidth >= 900 && panel) {
    // écran large : le panneau est à gauche de la carte, pas en bas
    return { top: Math.max(tb, 12), bottom: dock, left: 444 };
  }
  return { top: Math.max(tb, s?.topInset?.() || 0, 12), bottom: dock + panel, left: 0 };
}

function showScreen(name) {
  if (!app.screens[name]) name = 'carte';
  const prev = app.screen;
  if (prev && prev !== name && app.screens[prev]) {
    app.screens[prev].hide?.();
    $(`#screen-${prev}`).hidden = true;
  }
  app.screen = name;
  $(`#screen-${name}`).hidden = false;
  for (const t of $$('.tab')) {
    if (t.dataset.tab === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  }
  $('#topbar').hidden = !(name === 'carte' || name === 'planifier');
  $('#search-results').hidden = true;
  app.screens[name].show?.();
  updateChrome();
}

function updateChrome() {
  const riding = rideScreen.isActive();
  $('#map-ctrl').hidden = app.screen === 'rouler' && riding;
  const pill = $('#rec-pill');
  const active = riding || recorder.isActive();
  pill.hidden = !active || app.screen === 'rouler';
  if (!pill.hidden) {
    const r = recorder.recording();
    pill.textContent = recorder.isActive() ? `${r.state === 'paused' ? 'En pause' : 'Enregistrement'} · ${fmtKm(r.dist)} · ${fmtClock(recorder.elapsed())}` : 'Guidage en cours';
  }
  $('.tab-ride').classList.toggle('recording', recorder.isActive());
}

/* ---------- recherche de lieux ---------- */
function setupSearch() {
  const input = $('#search-input'), results = $('#search-results'), clearBtn = $('#search-clear');
  let ctrl = null, pin = null;
  const pick = (place) => {
    results.hidden = true;
    input.value = place.name;
    input.blur();
    const s = app.screens[app.screen];
    if (s.onSearchPick) { s.onSearchPick(place); return; }
    pin?.remove();
    pin = addMarker(h('div', { class: 'mk-meet' }, icon('pin', 'sm')), [place.lon, place.lat]);
    flyTo([place.lon, place.lat], 13);
    toast(place.name, { action: 'Planifier jusqu’ici', onAction: () => { pin?.remove(); planner.routeTo(place.lon, place.lat, place.name); }, timeout: 9000 });
  };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 3) { results.hidden = true; return; }
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const c = app.map.getCenter();
      const places = await searchPlaces(q, [c.lng, c.lat], { signal: ctrl.signal });
      clear(results);
      if (!places.length) results.append(h('p', { style: { padding: '14px 16px' } }, 'Aucun lieu trouvé.'));
      for (const p of places) {
        const b = h('button', { type: 'button' }, h('b', {}, p.name), p.label ? h('small', {}, p.label) : null);
        b.onclick = () => pick(p);
        results.append(b);
      }
      results.hidden = false;
    } catch (e) {
      if (e.name === 'AbortError') return;
      clear(results).append(h('p', { style: { padding: '14px 16px' } }, e.offline ? 'Recherche indisponible hors connexion.' : 'Recherche indisponible pour le moment.'));
      results.hidden = false;
    }
  }, 450);
  input.addEventListener('input', () => { clearBtn.hidden = !input.value; run(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); results.querySelector('button')?.click(); } });
  clearBtn.onclick = () => { input.value = ''; clearBtn.hidden = true; results.hidden = true; pin?.remove(); pin = null; input.focus(); };
  app.map.on('click', () => { results.hidden = true; });
}

/* ---------- contrôles de la carte ---------- */
function setupControls() {
  $('#btn-layers').onclick = () => openLayers();
  $('#btn-settings').onclick = () => openSettings();
  let tracking = null;
  const locBtn = $('#btn-locate');
  locBtn.onclick = async () => {
    if (tracking) { tracking(); tracking = null; locBtn.classList.remove('on'); return; }
    locBtn.classList.add('on');
    try {
      const p = await loc.once({ maxAge: 10000 });
      showMe(p);
      flyTo([p.lon, p.lat], Math.max(app.map.getZoom(), 13));
      tracking = loc.subscribe((pos) => { if (!rideScreen.isActive()) showMe(pos); });
    } catch (e) {
      locBtn.classList.remove('on');
      toast(loc.errorText(e), { error: true });
    }
  };
  const north = h('button', { class: 'fab', type: 'button', 'aria-label': 'Remettre le nord en haut', hidden: true }, icon('north'));
  north.onclick = () => app.map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
  $('#map-ctrl').append(north);
  app.map.on('rotate', () => { north.hidden = rideScreen.isActive() || Math.abs(app.map.getBearing()) < 2; });
  $('#rec-pill').onclick = () => showScreen('rouler');
  for (const t of $$('.tab')) t.onclick = () => showScreen(t.dataset.tab);
}

/* ---------- service worker et fichiers partagés ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  let wantReload = false;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Une nouvelle version de Lacets est prête.', {
            action: 'Mettre à jour', timeout: 0,
            onAction: () => { if (rideScreen.isActive()) { toast('Termine d’abord ta balade.'); return; } wantReload = true; nw.postMessage('skip-waiting'); },
          });
        }
      });
    });
  }).catch((e) => console.warn('Service worker :', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload) location.reload(); });
}

async function readSharedFiles() {
  const params = new URLSearchParams(location.search);
  if (!params.has('partage') || !('caches' in window)) return;
  history.replaceState(null, '', location.pathname);
  const cache = await caches.open('lacets-partage');
  const files = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    const name = decodeURIComponent(res.headers.get('x-filename') || 'partage.gpx');
    files.push(new File([await res.blob()], name));
    await cache.delete(req);
  }
  if (files.length) importFiles(files);
}

async function checkInterruptedRide() {
  const saved = await recorder.pendingRecording();
  if (!saved) return;
  const choice = await actionSheet(`Balade interrompue (${fmtKm(saved.dist)}) : que veux-tu en faire ?`, [
    { key: 'resume', label: 'Reprendre l’enregistrement', icon: 'play', primary: true },
    { key: 'save', label: 'Terminer et enregistrer', icon: 'check' },
    { key: 'discard', label: 'Supprimer la trace', icon: 'trash', danger: true },
  ]);
  if (choice === 'resume') rideScreen.resumeRecording(saved);
  else if (choice === 'save') {
    const meta = await recorder.finishSaved(saved);
    if (meta) { toast(`« ${meta.name} » enregistrée.`); emit('open-item', meta.id); }
    else toast('Balade trop courte : aucun point GPS à enregistrer.');
  }
  else if (choice === 'discard') await recorder.finishSaved(saved, { discard: true });
}

function setupDrop() {
  window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.(gpx|zip|xml)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    importFiles(files);
  });
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const files = await Promise.all((params.files || []).map((f) => f.getFile()));
      if (files.length) importFiles(files);
    });
  }
  $('#gpx-input').addEventListener('change', (e) => importFiles([...e.target.files]));
}

function fatal(msg) {
  document.getElementById('app').append(h('div', { class: 'welcome', style: { top: '40px', bottom: 'auto' } }, h('h2', {}, 'Lacets ne peut pas démarrer'), h('p', {}, msg)));
}

async function boot() {
  app.settings = { ...DEFAULTS, ...((await kv.get('settings').catch(() => null)) || {}) };
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  if (!window.maplibregl) { fatal('La bibliothèque de carte n’a pas pu être chargée. Recharge la page.'); return; }
  enableTileCache();
  const map = initMap('map', { center: app.settings.view.center, zoom: app.settings.view.zoom, basemap: app.settings.basemap, transformRequest });
  app.insets = insets;
  window.__lacets = app; // accès de débogage depuis la console
  app.debug = { loc, recorder };
  map.on('click', (e) => app.screens[app.screen]?.onMapClick?.(e));
  map.on('moveend', debounce(() => {
    if (rideScreen.isActive()) return;
    app.settings.view = { center: map.getCenter().toArray().map((v) => +v.toFixed(5)), zoom: +map.getZoom().toFixed(2) };
    saveSettings();
  }, 1500));

  app.screens = { carte, planifier: planner, rouler: rideScreen, parcours: library, communaute: community };
  for (const [name, screen] of Object.entries(app.screens)) {
    try { await screen.mount($(`#screen-${name}`)); }
    catch (e) { console.error(`Écran ${name}`, e); }
  }
  on('show-screen', showScreen);
  on('settings-changed', () => saveSettings());
  on('theme-changed', applyTheme);
  on('ride-state', updateChrome);
  on('rec-state', updateChrome);
  setInterval(updateChrome, 1000);

  setupControls();
  setupSearch();
  setupDrop();
  const start = new URLSearchParams(location.search).get('ecran');
  app.screen = null;
  showScreen(app.screens[start] ? start : 'carte');
  registerSW();
  readSharedFiles().catch(() => {});
  checkInterruptedRide().catch(() => {});
  if (!navigator.onLine) toast('Hors connexion : tes parcours et la carte déjà vue restent disponibles.', { timeout: 5000 });
  window.addEventListener('online', () => toast('Connexion retrouvée.', { timeout: 2000 }));
  window.addEventListener('offline', () => toast('Hors connexion : la carte déjà vue et tes parcours restent disponibles.', { timeout: 5000 }));
}

boot().catch((e) => { console.error(e); fatal(e.message || String(e)); });
