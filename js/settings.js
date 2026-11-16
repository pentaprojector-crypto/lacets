// Réglages, fonds de carte et sauvegarde complète des données.
import { app, emit } from './state.js';
import { h, icon, openModal, segmented, switchRow, toast, downloadBlob, safeFilename, confirmBox, pickFiles, fmtInt } from './ui.js';
import { BASEMAPS, setBasemap, basemap } from './mapview.js';
import { listItems, getGeom, allPhotos, put, savePhoto, storageEstimate } from './db.js';
import { makeZip, readZip } from './zip.js';
import { toGpx } from './gpx.js';
import { tileCacheSize, clearTileCache } from './offline.js';
import { speak } from './ride.js';

export function openLayers() {
  return openModal((box, done) => {
    const grid = h('div', { class: 'layers', role: 'group', 'aria-label': 'Fond de carte' });
    for (const [k, b] of Object.entries(BASEMAPS)) {
      const btn = h('button', { class: 'layer-btn', type: 'button', 'aria-pressed': String(basemap() === k) },
        h('span', { class: 'sw', style: { background: b.swatch } }), h('b', {}, b.label), h('small', {}, b.hint));
      btn.onclick = () => {
        setBasemap(k);
        app.settings.basemap = k;
        emit('settings-changed');
        for (const c of grid.children) c.setAttribute('aria-pressed', String(c === btn));
      };
      grid.append(btn);
    }
    box.append(
      h('h2', {}, 'Fond de carte'), grid,
      switchRow('set-alerts', 'Afficher les dangers signalés', app.settings.showAlerts !== false, (v) => { app.settings.showAlerts = v; emit('settings-changed'); }, 'Triangles rouges de la communauté'),
      h('button', { class: 'btn btn-lg', type: 'button', onClick: () => done() }, 'Fermer'));
  });
}

async function exportBackup() {
  const t = toast('Préparation de la sauvegarde…', { timeout: 0 });
  try {
    const items = await listItems();
    const geoms = [];
    for (const m of items) geoms.push(await getGeom(m.id));
    const photos = await allPhotos();
    const files = [];
    const photoMeta = photos.map(({ blob, thumb, ...p }) => ({ ...p, file: `photos/${p.id}.jpg`, thumbFile: thumb ? `photos/${p.id}-mini.jpg` : null }));
    files.push({ name: 'lacets.json', data: JSON.stringify({ app: 'Lacets', version: 1, exportedAt: new Date().toISOString(), items, geoms: geoms.filter(Boolean), photos: photoMeta }) });
    for (const p of photos) {
      files.push({ name: `photos/${p.id}.jpg`, data: p.blob });
      if (p.thumb) files.push({ name: `photos/${p.id}-mini.jpg`, data: p.thumb });
    }
    const used = new Set();
    items.forEach((m, i) => {
      const g = geoms[i];
      if (!g?.segments?.some((s) => s.length > 1)) return;
      let name = safeFilename(m.name, 'gpx');
      for (let n = 2; used.has(name); n++) name = safeFilename(`${m.name} ${n}`, 'gpx');
      used.add(name);
      files.push({ name: `gpx/${name}`, data: toGpx(m, g) });
    });
    const zip = await makeZip(files);
    downloadBlob(zip, `lacets-sauvegarde-${new Date().toISOString().slice(0, 10)}.zip`);
    t.remove();
    toast(`Sauvegarde téléchargée : ${fmtInt(items.length)} parcours, ${fmtInt(photos.length)} photos.`);
  } catch (e) {
    t.remove();
    toast(`Sauvegarde impossible : ${e.message}`, { error: true });
  }
}

async function restoreBackup() {
  const [file] = await pickFiles({ accept: '.zip,application/zip', multiple: false });
  if (!file) return;
  try {
    const entries = await readZip(file);
    const json = entries.get('lacets.json');
    if (!json) throw new Error('ce fichier n’est pas une sauvegarde Lacets');
    const data = JSON.parse(new TextDecoder().decode(json));
    if (!(await confirmBox({ title: 'Restaurer la sauvegarde ?', text: `${fmtInt(data.items.length)} parcours et ${fmtInt(data.photos.length)} photos seront ajoutés. Les parcours déjà présents seront remplacés par leur version sauvegardée.`, ok: 'Restaurer' }))) return;
    for (const m of data.items) await put('items', m);
    for (const g of data.geoms) await put('geoms', g);
    for (const p of data.photos) {
      const blob = entries.get(p.file);
      if (!blob) continue;
      const thumb = p.thumbFile && entries.get(p.thumbFile);
      const { file: _f, thumbFile: _t, ...rest } = p;
      await savePhoto({ ...rest, blob: new Blob([blob], { type: 'image/jpeg' }), thumb: thumb ? new Blob([thumb], { type: 'image/jpeg' }) : null });
    }
    emit('items-changed', {});
    toast('Sauvegarde restaurée.');
  } catch (e) {
    toast(`Restauration impossible : ${e.message}`, { error: true });
  }
}

export function openSettings() {
  return openModal(async (box, done) => {
    const theme = segmented([['auto', 'Auto'], ['light', 'Jour'], ['dark', 'Nuit']], app.settings.theme || 'auto', (v) => { app.settings.theme = v; emit('settings-changed'); emit('theme-changed'); }, { label: 'Thème' });
    const usage = h('p', { class: 'hint' }, 'Calcul de l’espace utilisé…');
    const tiles = h('button', { class: 'btn', type: 'button' }, icon('offline'), 'Vider la carte hors ligne');
    tiles.onclick = async () => { await clearTileCache(); toast('Carte hors ligne effacée.'); tiles.disabled = true; };
    const test = h('button', { class: 'btn', type: 'button' }, icon('volume'), 'Tester la voix');
    test.onclick = () => speak('Dans 300 mètres, tournez à droite sur la D 42.', { force: true });
    const exp = h('button', { class: 'btn', type: 'button' }, icon('download'), 'Exporter une sauvegarde');
    exp.onclick = exportBackup;
    const imp = h('button', { class: 'btn', type: 'button' }, icon('upload'), 'Restaurer une sauvegarde');
    imp.onclick = restoreBackup;
    const share = h('button', { class: 'btn', type: 'button' }, icon('users'), 'Partage avec tes potes');
    share.onclick = () => { done(); emit('show-screen', 'communaute'); };
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
    box.append(
      h('h2', {}, 'Réglages'),
      h('div', { class: 'settings' },
        h('section', {}, h('h3', { class: 'section-title' }, 'Affichage'), theme),
        h('section', {}, h('h3', { class: 'section-title' }, 'Guidage'),
          switchRow('set-voice', 'Consignes vocales', app.settings.voice !== false, (v) => { app.settings.voice = v; emit('settings-changed'); }),
          h('div', { class: 'btn-row' }, test)),
        h('section', {}, h('h3', { class: 'section-title' }, 'Mes données'),
          h('p', { class: 'hint' }, 'Parcours et photos sont stockés dans ce navigateur. Exporte une sauvegarde de temps en temps : elle contient aussi chaque parcours en GPX.'),
          h('div', { class: 'btn-row' }, exp, imp), usage, h('div', { class: 'btn-row' }, tiles, share)),
        h('section', {}, h('h3', { class: 'section-title' }, 'Crédits'),
          h('div', { class: 'credits' },
            h('p', {}, 'Cartes : ', link('https://openfreemap.org', 'OpenFreeMap'), ', ', link('https://www.ign.fr', 'IGN'), ', ', link('https://opentopomap.org', 'OpenTopoMap'), ', données ', link('https://www.openstreetmap.org/copyright', '© les contributeurs OpenStreetMap'), '.'),
            h('p', {}, 'Itinéraires : ', link('https://valhalla.openstreetmap.de', 'Valhalla'), ' et OSRM hébergés par FOSSGIS (une requête par seconde au maximum).'),
            h('p', {}, 'Recherche : ', link('https://photon.komoot.io', 'Photon par komoot'), '. Altitudes : ', link('https://open-meteo.com', 'Open-Meteo'), ', modèle Copernicus DEM.'),
            h('p', {}, 'Affichage : ', link('https://maplibre.org', 'MapLibre GL JS'), '. Police : Barlow (OFL).'))),
      ),
      h('button', { class: 'btn btn-lg', type: 'button', onClick: () => done() }, 'Fermer'));
    const [est, n] = await Promise.all([storageEstimate(), tileCacheSize()]);
    usage.textContent = `${est ? `Espace utilisé : ${fmtInt((est.usage || 0) / 1e6)} Mo. ` : ''}Carte hors ligne : ${fmtInt(n)} morceaux.`;
    tiles.disabled = !n;
  });
}
