// Bibliothèque : liste des parcours (planifiés, balades, GPX importés) et fiche détaillée avec photos.
import { app, emit, on } from './state.js';
import {
  h, icon, clear, toast, Sheet, fmtKm, fmtDur, fmtEle, fmtSpeed, fmtDate, fmtInt, drawSilhouette, confirmBox,
  actionSheet, downloadBlob, safeFilename, pickFiles, debounce, pushBack, plural,
} from './ui.js';
import { listItems, getItem, getGeom, saveItem, deleteItem, listPhotos, savePhoto } from './db.js';
import { setData, clearData, addMarker, fitBounds, flyTo, multiLine, colors } from './mapview.js';
import { readGpxFile, toGpx, parseGpx, gpxToItem } from './gpx.js';
import { readZip } from './zip.js';
import { Profile } from './profile.js';
import { profileOf, flatten, cumulative, sampleAlong, computeStats } from './geo.js';
import { elevations } from './services.js';
import { importPhotos, openViewer, PhotoLayer } from './photos.js';
import { planner } from './planner.js';
import { prepareOffline } from './offline.js';

export const KIND_LABEL = { plan: 'Planifié', ride: 'Balade', import: 'GPX importé' };
const FILTERS = [['all', 'Tous'], ['plan', 'Planifiés'], ['ride', 'Balades'], ['import', 'Importés']];

let items = [];
let filter = 'all', query = '';
let panel, rowsEl, emptyEl, searchEl, chipsEl;
let sheet, d = {}, cur = null, releaseDetail = null, visible = false;
let profile, hoverMarker = null, flagMarkers = [], poiMarkers = [];
const photoLayer = new PhotoLayer();

export const kindColor = (kind) => colors()[kind] || colors().ink;

/* ---------- import ---------- */
export async function importFiles(files) {
  const done = [], errors = [];
  for (const f of files) {
    try {
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
        const entries = await readZip(f);
        for (const [name, data] of entries) {
          if (!/\.gpx$/i.test(name)) continue;
          const r = gpxToItem(parseGpx(new TextDecoder().decode(data)), name.split('/').pop());
          await saveItem(r.meta, r.geom);
          done.push(r.meta);
        }
      } else {
        const r = await readGpxFile(f);
        await saveItem(r.meta, r.geom);
        done.push(r.meta);
      }
    } catch (e) {
      errors.push(`${f.name} : ${e.message}`);
    }
  }
  if (errors.length) toast(errors.join(' · '), { error: true, timeout: 8000 });
  if (done.length === 1) { toast(`« ${done[0].name} » importé.`); openItem(done[0].id); }
  else if (done.length > 1) { toast(`${done.length} parcours importés.`); emit('show-screen', 'parcours'); }
  return done;
}

export async function pickAndImport() {
  const files = await pickFiles({ multiple: true });
  if (files.length) await importFiles(files);
}

export async function refreshItems() {
  items = await listItems().catch(() => []);
  items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  emit('items-loaded', items);
  if (rowsEl) renderList();
  return items;
}
export const getItems = () => items;

/* ---------- liste ---------- */
function buildPanel(root) {
  searchEl = h('input', { class: 'input', type: 'search', id: 'lib-search', placeholder: 'Rechercher un parcours', 'aria-label': 'Rechercher un parcours' });
  searchEl.addEventListener('input', debounce(() => { query = searchEl.value.trim().toLowerCase(); renderList(); }, 150));
  chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer' },
    FILTERS.map(([k, label]) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === filter) }, label);
      b.onclick = () => { filter = k; for (const c of chipsEl.children) c.setAttribute('aria-pressed', String(c === b)); renderList(); };
      return b;
    }));
  const importBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('upload'), 'Importer un GPX');
  importBtn.onclick = pickAndImport;
  rowsEl = h('div', { class: 'rows' });
  emptyEl = h('div', { class: 'empty' });
  panel = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('div', { class: 'panel-head-row' }, h('h1', {}, 'Mes parcours'), importBtn), searchEl, chipsEl),
    h('div', { class: 'panel-body' }, rowsEl, emptyEl));
  root.append(panel);
}

function renderList() {
  clear(rowsEl);
  const list = items.filter((m) => (filter === 'all' || m.kind === filter) && (!query || m.name.toLowerCase().includes(query)));
  emptyEl.hidden = list.length > 0;
  clear(emptyEl);
  if (!items.length) {
    const imp = h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, icon('upload'), 'Importer un GPX');
    const plan = h('button', { class: 'btn btn-lg', type: 'button' }, icon('plan'), 'Planifier un parcours');
    imp.onclick = pickAndImport;
    plan.onclick = () => emit('show-screen', 'planifier');
    emptyEl.append(h('h2', {}, 'Aucun parcours pour l’instant'),
      h('p', { class: 'muted' }, 'Importe un fichier GPX reçu d’un pote ou d’une appli, planifie ton propre itinéraire, ou lance l’enregistrement depuis l’onglet Rouler.'),
      h('div', { class: 'btn-row' }, imp, plan));
  } else if (!list.length) {
    emptyEl.append(h('p', { class: 'muted' }, 'Aucun parcours ne correspond à ta recherche.'));
  }
  const color = colors();
  for (const m of list) {
    const canvas = h('canvas', { class: 'thumb', 'aria-hidden': 'true' });
    const s = m.stats || {};
    const metaBits = [
      h('span', {}, KIND_LABEL[m.kind] || ''),
      m.date || m.createdAt ? h('span', {}, fmtDate(m.date || m.createdAt)) : null,
      s.distance ? h('span', { class: 'num' }, fmtKm(s.distance)) : null,
      s.gain ? h('span', { class: 'num' }, `D+ ${fmtEle(s.gain)}`) : null,
    ];
    const row = h('button', { class: `row k-${m.kind}`, type: 'button' }, canvas,
      h('span', { class: 'row-main' }, h('b', {}, m.name), h('span', { class: 'row-meta' }, metaBits)),
      icon('back', 'sm'));
    row.lastChild.style.transform = 'rotate(180deg)';
    row.onclick = () => openItem(m.id);
    rowsEl.append(row);
    drawSilhouette(canvas, m.preview, color[m.kind] || color.ink);
  }
}

/* ---------- fiche ---------- */
function buildSheet(root) {
  sheet = new Sheet({ peek: 196, half: 0.5, full: 0.93, initial: 'half', onSnap: () => emit('insets-changed') });
  sheet.el.hidden = true;
  root.append(sheet.el);
  d.back = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Retour à la liste' }, icon('back'));
  d.back.onclick = () => closeDetail(false);
  d.name = h('input', { class: 'name-input', id: 'item-name', 'aria-label': 'Nom du parcours', enterkeyhint: 'done' });
  d.name.addEventListener('change', async () => { if (!cur) return; cur.meta.name = d.name.value.trim() || cur.meta.name; await saveItem(cur.meta); });
  d.more = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Plus d’actions' }, icon('more'));
  d.more.onclick = moreMenu;
  d.kind = h('div', { class: 'kind-tag' });
  d.summary = h('div', { class: 'summary-line' });
  d.ride = h('button', { class: 'btn btn-primary', type: 'button' }, icon('nav'), 'Rouler');
  d.ride.onclick = () => emit('ride-with', cur.meta.id);
  d.edit = h('button', { class: 'btn', type: 'button', title: 'Ouvrir dans le planificateur' }, icon('edit'), 'Modifier');
  d.edit.onclick = () => (cur.meta.kind === 'plan' ? planner.edit(cur.meta.id) : planner.fromItem(cur.meta, cur.geom));
  d.gpx = h('button', { class: 'btn compact', type: 'button', 'aria-label': 'Exporter en GPX' }, icon('download'), 'GPX');
  d.gpx.onclick = exportGpx;
  sheet.head.append(
    h('div', { class: 'sheet-title-row' }, d.back, d.name, d.more),
    d.kind, d.summary,
    h('div', { class: 'btn-row', style: { marginTop: '10px' } }, d.ride, d.edit, d.gpx));

  d.stats = h('div', { class: 'stats' });
  d.profileBox = h('div');
  d.profileNote = h('div', { class: 'btn-row' });
  profile = new Profile(d.profileBox, {
    onHover: (p) => {
      if (!p) { hoverMarker?.remove(); hoverMarker = null; return; }
      if (!hoverMarker) hoverMarker = addMarker(h('div', { class: 'mk-hover' }), [p.lon, p.lat]);
      hoverMarker.setLngLat([p.lon, p.lat]);
    },
  });
  d.photos = h('div', { class: 'photos' });
  d.photoCount = h('span', { class: 'muted small' });
  d.notes = h('textarea', { class: 'input', id: 'item-notes', placeholder: 'Impressions, état de la route, bonnes adresses…' });
  d.notes.addEventListener('input', debounce(async () => { if (!cur) return; cur.meta.notes = d.notes.value; await saveItem(cur.meta); }, 600));
  d.source = h('p', { class: 'hint' });
  sheet.body.append(
    d.stats,
    h('section', {}, h('h3', { class: 'section-title' }, 'Profil'), d.profileBox, d.profileNote),
    h('section', {}, h('h3', { class: 'section-title' }, 'Photos', d.photoCount), d.photos),
    h('section', {}, h('label', { class: 'section-title', for: 'item-notes' }, 'Notes'), d.notes),
    d.source);
}

export async function openItem(id) {
  emit('show-screen', 'parcours');
  const meta = await getItem(id);
  if (!meta) { toast('Ce parcours n’existe plus.', { error: true }); return; }
  const geom = (await getGeom(id)) || { segments: [] };
  if (!releaseDetail) releaseDetail = pushBack(() => { releaseDetail = null; closeDetail(true); });
  cur = { meta, geom, photos: await listPhotos(id) };
  panel.hidden = true;
  sheet.el.hidden = false;
  document.body.classList.add('has-sheet');
  sheet.setSnap('half');
  renderDetail();
  drawItem(true);
}

function closeDetail(fromBack) {
  if (!fromBack && releaseDetail) { const r = releaseDetail; releaseDetail = null; r(); }
  cur = null;
  clearMapItem();
  if (!sheet) return;
  sheet.el.hidden = true;
  panel.hidden = false;
  document.body.classList.remove('has-sheet');
  emit('insets-changed');
}

function stat(value, label) { return h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label)); }

function renderDetail() {
  const { meta, geom } = cur;
  const s = meta.stats || {};
  d.name.value = meta.name;
  sheet.el.className = `sheet k-${meta.kind}`;
  clear(d.kind).append(`${KIND_LABEL[meta.kind]}${meta.date ? ' · ' + fmtDate(meta.date) : meta.createdAt ? ' · ' + fmtDate(meta.createdAt) : ''}`);
  clear(d.summary);
  d.summary.append(h('b', {}, fmtKm(s.distance)));
  const duration = meta.kind === 'plan' ? s.estTime : s.duration;
  if (duration) d.summary.append(h('b', {}, fmtDur(duration)));
  if (s.gain != null) d.summary.append(h('b', {}, `D+ ${fmtEle(s.gain)}`));
  d.ride.disabled = !geom.segments?.some((x) => x.length > 1);

  clear(d.stats);
  if (meta.kind === 'plan') {
    d.stats.append(stat(fmtKm(s.distance), 'Distance'), stat(fmtDur(s.estTime), 'Durée estimée'),
      stat(fmtEle(s.gain), 'Dénivelé +'), stat(fmtEle(s.loss), 'Dénivelé −'), stat(fmtEle(s.maxEle), 'Altitude max'),
      stat(fmtInt(meta.waypoints?.length || 0), 'Étapes'));
  } else if (s.hasTime) {
    d.stats.append(stat(fmtKm(s.distance), 'Distance'), stat(fmtDur(s.duration), 'Durée totale'), stat(fmtDur(s.moving), 'En mouvement'),
      stat(`${fmtSpeed(s.avgSpeed)} km/h`, 'Moyenne'), stat(`${fmtSpeed(s.maxSpeed)} km/h`, 'Vitesse max'),
      stat(fmtEle(s.gain), 'Dénivelé +'), stat(fmtEle(s.loss), 'Dénivelé −'), stat(fmtEle(s.maxEle), 'Altitude max'));
  } else {
    d.stats.append(stat(fmtKm(s.distance), 'Distance'), stat(fmtEle(s.gain), 'Dénivelé +'), stat(fmtEle(s.loss), 'Dénivelé −'),
      stat(fmtEle(s.maxEle), 'Altitude max'), stat(fmtInt(s.points), 'Points GPS'));
  }

  renderProfile();
  renderPhotos();
  d.notes.value = meta.notes || '';
  const src = meta.source;
  d.source.textContent = src
    ? `Importé depuis ${src.filename || 'un fichier GPX'}${src.creator ? ` (créé avec ${src.creator})` : ''} · ${src.type === 'route' ? 'route à étapes' : src.type === 'trace' ? 'trace GPS' : 'points'}.`
    : meta.kind === 'plan' ? `Itinéraire calculé par ${meta.engine?.includes('osrm') ? 'OSRM (secours)' : meta.engine === 'straight' ? 'lignes droites' : 'Valhalla, profil moto'}.` : '';
}

function renderProfile() {
  const { meta, geom } = cur;
  clear(d.profileNote);
  if (meta.stats?.hasEle) profile.set(profileOf(geom.segments || []), { colorVar: `--${meta.kind === 'import' ? 'import' : meta.kind === 'ride' ? 'ride' : 'route'}` });
  else if (meta.elevProfile?.length) profile.set(meta.elevProfile, { colorVar: '--import' });
  else {
    profile.set([], { message: 'Ce fichier ne contient pas d’altitudes.' });
    if (geom.segments?.some((x) => x.length > 1)) {
      const b = h('button', { class: 'btn', type: 'button' }, icon('mountain'), 'Estimer le dénivelé');
      b.onclick = () => estimateElevation(b);
      d.profileNote.append(b);
    }
  }
}

async function estimateElevation(btn) {
  const { meta, geom } = cur;
  btn.disabled = true;
  btn.lastChild.textContent = 'Calcul…';
  try {
    const flat = flatten(geom.segments);
    const cum = cumulative(flat);
    const n = Math.max(20, Math.min(300, Math.round(cum[cum.length - 1] / 250)));
    const samples = sampleAlong(flat, cum, n);
    const es = await elevations(samples);
    const pts = samples.map((s, i) => ({ d: s[2], e: es[i], lon: s[0], lat: s[1] })).filter((p) => Number.isFinite(p.e));
    const st = computeStats([pts.map((p) => [p.lon, p.lat, p.e, null])], { eleThreshold: 3 });
    Object.assign(meta.stats, { gain: st.gain, loss: st.loss, minEle: st.minEle, maxEle: st.maxEle, eleSource: 'dem' });
    meta.elevProfile = pts;
    await saveItem(meta);
    if (cur?.meta.id === meta.id) renderDetail();
  } catch (e) {
    toast(e.offline ? 'Hors connexion : réessaie une fois en ligne.' : 'Altitudes indisponibles pour le moment.', { error: true });
    btn.disabled = false;
    btn.lastChild.textContent = 'Estimer le dénivelé';
  }
}

function renderPhotos() {
  for (const t of d.photos.querySelectorAll('[data-url]')) URL.revokeObjectURL(t.dataset.url);
  clear(d.photos);
  const photos = cur.photos;
  d.photoCount.textContent = photos.length ? plural(photos.length, 'photo', 'photos') : '';
  photos.forEach((p, i) => {
    const url = URL.createObjectURL(p.thumb || p.blob);
    const tile = h('button', { class: 'photo-tile', type: 'button', dataset: { url }, style: { backgroundImage: `url("${url}")` }, 'aria-label': p.caption || `Photo ${i + 1}` },
      p.lon == null ? h('span', { class: 'nogps' }, 'À placer') : null);
    tile.onclick = () => openViewer(cur.photos, i, {
      onLocate: (ph) => { sheet.setSnap('peek'); flyTo([ph.lon, ph.lat], 15); },
      onPlace: (ph) => startPlacing(ph),
    });
    d.photos.append(tile);
  });
  const add = h('button', { class: 'photo-tile photo-add', type: 'button' }, icon('image'), 'Ajouter');
  add.onclick = addPhotos;
  d.photos.append(add);
  showPhotoMarkers();
}

function showPhotoMarkers() {
  if (!cur) return;
  photoLayer.show(cur.photos, (p) => openViewer(cur.photos, cur.photos.indexOf(p), {
    onLocate: (ph) => flyTo([ph.lon, ph.lat], 15),
    onPlace: (ph) => startPlacing(ph),
  }));
}

async function addPhotos() {
  const files = await pickFiles({ accept: 'image/*', multiple: true });
  if (!files.length || !cur) return;
  const id = cur.meta.id;
  toast(`Ajout de ${plural(files.length, 'photo', 'photos')}…`, { timeout: 2000 });
  const r = await importPhotos(id, files, { segments: cur.geom.segments });
  if (cur?.meta.id !== id) return;
  cur.photos = await listPhotos(id);
  renderPhotos();
  if (r.unplaced) toast(`${plural(r.unplaced, 'photo n’a', 'photos n’ont')} pas de position : touche-la puis « Placer sur la carte ».`, { timeout: 6000 });
}

function startPlacing(photo) {
  sheet.setSnap('peek');
  const cross = h('div', { class: 'crosshair', 'aria-hidden': 'true' });
  const ok = h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, icon('check'), 'Valider la position');
  const cancel = h('button', { class: 'btn btn-lg', type: 'button' }, 'Annuler');
  const bar = h('div', { class: 'place-bar' }, h('p', {}, 'Déplace la carte pour viser l’endroit où la photo a été prise.'), h('div', { class: 'btn-row' }, cancel, ok));
  const app_ = document.getElementById('app');
  app_.append(cross, bar);
  const end = () => { cross.remove(); bar.remove(); };
  cancel.onclick = end;
  ok.onclick = async () => {
    const r = cross.getBoundingClientRect();
    const mr = app.map.getContainer().getBoundingClientRect();
    const ll = app.map.unproject([r.left + r.width / 2 - mr.left, r.top + r.height / 2 - mr.top]);
    photo.lon = ll.lng; photo.lat = ll.lat; photo.placedBy = 'manuel';
    await savePhoto(photo);
    end();
    if (cur) { cur.photos = await listPhotos(cur.meta.id); renderPhotos(); }
    toast('Photo placée.');
  };
}

function drawItem(fit) {
  const { meta, geom } = cur;
  clearMapItem();
  const segs = (geom.segments || []).filter((s) => s.length > 1);
  if (segs.length) setData('ov-sel', multiLine(segs, { kind: meta.kind }));
  else if (meta.waypoints?.length > 1) setData('ov-sel', multiLine([meta.waypoints.map((w) => [w.lon, w.lat])], { kind: meta.kind }));
  const first = segs[0]?.[0], last = segs.at(-1)?.at(-1);
  if (first) flagMarkers.push(addMarker(h('div', { class: 'mk-flag start', title: 'Départ' }), [first[0], first[1]]));
  if (last && (Math.abs(last[0] - first[0]) > 1e-4 || Math.abs(last[1] - first[1]) > 1e-4)) flagMarkers.push(addMarker(h('div', { class: 'mk-flag end', title: 'Arrivée' }), [last[0], last[1]]));
  for (const p of geom.pois || []) {
    const el = h('button', { class: 'mk-poi', type: 'button', 'aria-label': p.name || 'Point' });
    el.onclick = (e) => { e.stopPropagation(); toast(p.name ? `${p.name}${p.desc ? ' — ' + p.desc : ''}` : 'Point du GPX'); };
    poiMarkers.push(addMarker(el, [p.lon, p.lat]));
  }
  showPhotoMarkers();
  if (fit && meta.stats?.bbox) setTimeout(() => fitBounds(meta.stats.bbox), 30);
}

function clearMapItem() {
  clearData('ov-sel');
  flagMarkers.forEach((m) => m.remove()); flagMarkers = [];
  poiMarkers.forEach((m) => m.remove()); poiMarkers = [];
  hoverMarker?.remove(); hoverMarker = null;
  photoLayer.clear();
}

async function exportGpx() {
  const { meta, geom, photos } = cur;
  let opts = { track: true, route: true };
  if (meta.waypoints?.length >= 2 && geom.segments?.length) {
    const c = await actionSheet('Exporter en GPX', [
      { key: 'both', label: 'Trace + étapes (recommandé)', primary: true },
      { key: 'track', label: 'Trace seule (compatible partout)' },
      { key: 'route', label: 'Étapes seules (GPS qui recalcule)' },
    ]);
    if (!c) return;
    opts = { track: c !== 'route', route: c !== 'track' };
  }
  const gpx = toGpx(meta, geom, { ...opts, photos });
  downloadBlob(new Blob([gpx], { type: 'application/gpx+xml' }), safeFilename(meta.name, 'gpx'));
  toast('GPX téléchargé.');
}

async function moreMenu() {
  const { meta, geom } = cur;
  const choice = await actionSheet(meta.name, [
    { key: 'offline', label: 'Préparer la carte hors ligne', icon: 'offline' },
    { key: 'share', label: 'Proposer une sortie avec ce parcours', icon: 'users' },
    { key: 'fit', label: 'Voir tout le parcours', icon: 'map' },
    { key: 'delete', label: 'Supprimer ce parcours', icon: 'trash', danger: true },
  ]);
  if (choice === 'fit') { sheet.setSnap('peek'); setTimeout(() => fitBounds(meta.stats?.bbox), 260); }
  if (choice === 'share') emit('propose-ride', { meta, geom });
  if (choice === 'offline') prepareOffline(flatten(geom.segments));
  if (choice === 'delete') {
    if (!(await confirmBox({ title: 'Supprimer ce parcours ?', text: `« ${meta.name} » et ses ${plural(cur.photos.length, 'photo', 'photos')} seront supprimés de ce téléphone.`, ok: 'Supprimer', danger: true }))) return;
    await deleteItem(meta.id);
    closeDetail(false);
    toast('Parcours supprimé.');
  }
}

export const library = {
  id: 'parcours',
  mount(root) {
    buildPanel(root);
    buildSheet(root);
    on('items-changed', () => refreshItems());
    on('photos-changed', async ({ itemId }) => {
      if (cur?.meta.id === itemId) { cur.photos = await listPhotos(itemId); if (visible) renderPhotos(); }
    });
    on('open-item', (id) => openItem(id));
    refreshItems();
  },
  show() {
    visible = true;
    if (cur) { document.body.classList.add('has-sheet'); sheet.apply(); drawItem(false); }
    else renderList();
  },
  hide() {
    visible = false;
    document.body.classList.remove('has-sheet');
    if (cur) clearMapItem();
  },
  bottomInset() { return cur && !sheet.el.hidden ? sheet.visibleHeight : 0; },
  coversMap() { return !cur; },
};
