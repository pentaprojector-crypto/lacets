// Photos des balades : compression, géolocalisation (GPS EXIF ou heure de prise de vue), visionneuse.
import { h, icon, uid, toast, confirmBox, fmtDateTime, pushBack } from './ui.js';
import { readExif } from './exif.js';
import { savePhoto, deletePhoto } from './db.js';
import { addMarker } from './mapview.js';

export async function compressImage(file, maxSize = 1600, quality = 0.82) {
  let src, cleanup = () => {};
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    cleanup = () => src.close?.();
  } catch {
    const url = URL.createObjectURL(file);
    src = new Image();
    src.src = url;
    await src.decode();
    cleanup = () => URL.revokeObjectURL(url);
  }
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), hh = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = hh;
  canvas.getContext('2d').drawImage(src, 0, 0, w, hh);
  cleanup();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  const ts = Math.min(1, 360 / Math.max(w, hh));
  const c2 = document.createElement('canvas');
  c2.width = Math.max(1, Math.round(w * ts)); c2.height = Math.max(1, Math.round(hh * ts));
  c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
  const thumb = await new Promise((r) => c2.toBlob(r, 'image/jpeg', 0.72));
  if (!blob) throw new Error('Compression impossible');
  return { blob, thumb, w, h: hh };
}

/** Position le long d'un tracé horodaté à un instant donné (interpolation). */
export function positionAtTime(segments, t) {
  for (const seg of segments || []) {
    const times = seg.filter((p) => p[3]);
    if (times.length < 2) continue;
    if (t < times[0][3] - 10 * 60e3 || t > times[times.length - 1][3] + 10 * 60e3) continue;
    let lo = 0, hi = times.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid][3] < t) lo = mid + 1; else hi = mid; }
    const b = times[lo], a = times[Math.max(0, lo - 1)];
    if (t <= a[3]) return [a[0], a[1]];
    if (t >= b[3]) return [b[0], b[1]];
    const k = (t - a[3]) / (b[3] - a[3]);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  return null;
}

const isImage = (f) => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '');

/** Ajoute des photos à un parcours. `here` sert de position par défaut (photo prise pendant la balade). */
export async function importPhotos(itemId, files, { segments = [], here = null } = {}) {
  let placed = 0, unplaced = 0, failed = 0;
  for (const file of files) {
    if (!isImage(file)) { failed++; continue; }
    let ex = {};
    try { ex = readExif(await file.arrayBuffer()) || {}; } catch { /* sans EXIF */ }
    let comp;
    try { comp = await compressImage(file); } catch { failed++; continue; }
    let lon = ex.lon ?? null, lat = ex.lat ?? null, how = lon != null ? 'gps' : null;
    if (lon == null && here) { lon = here.lon; lat = here.lat; how = 'position'; }
    if (lon == null && ex.time) {
      const p = positionAtTime(segments, ex.time);
      if (p) { [lon, lat] = p; how = 'heure'; }
    }
    await savePhoto({
      id: uid(), itemId, blob: comp.blob, thumb: comp.thumb, w: comp.w, h: comp.h,
      lon, lat, time: ex.time || (here ? Date.now() : file.lastModified || null),
      caption: '', placedBy: how, createdAt: Date.now(),
    });
    if (lon != null) placed++; else unplaced++;
  }
  if (failed) toast(`${failed} fichier(s) ignoré(s) : format d’image non lu.`, { error: true });
  return { placed, unplaced };
}

/* ---------- marqueurs sur la carte ---------- */
export class PhotoLayer {
  constructor() { this.markers = []; this.urls = []; }
  show(photos, onClick) {
    this.clear();
    for (const p of photos) {
      if (p.lon == null) continue;
      const url = URL.createObjectURL(p.thumb || p.blob);
      this.urls.push(url);
      const el = h('button', { class: 'mk-photo', type: 'button', 'aria-label': p.caption || 'Photo', style: { backgroundImage: `url("${url}")` } });
      el.addEventListener('click', (e) => { e.stopPropagation(); onClick?.(p); });
      this.markers.push(addMarker(el, [p.lon, p.lat], { anchor: 'bottom' }));
    }
  }
  clear() {
    this.markers.forEach((m) => m.remove());
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.markers = []; this.urls = [];
  }
}

/* ---------- visionneuse ---------- */
export function openViewer(photos, index, { onLocate, onPlace } = {}) {
  let i = index;
  let url = null;
  const img = h('img', { alt: '' });
  const caption = h('input', { class: 'input', id: 'photo-caption', placeholder: 'Ajouter une légende', enterkeyhint: 'done' });
  const meta = h('p', { class: 'small', style: { opacity: '.8' } });
  const counter = h('span', { style: { flex: '1', fontWeight: '600' } });
  const btnLocate = h('button', { class: 'btn', type: 'button' }, icon('pin'), 'Voir sur la carte');
  const btnPlace = h('button', { class: 'btn', type: 'button' }, icon('pin'), 'Placer sur la carte');
  const btnShare = h('button', { class: 'btn-icon btn', type: 'button', 'aria-label': 'Partager la photo' }, icon('share'));
  const btnDel = h('button', { class: 'btn-icon btn', type: 'button', 'aria-label': 'Supprimer la photo' }, icon('trash'));
  const btnClose = h('button', { class: 'btn-icon btn', type: 'button', 'aria-label': 'Fermer' }, icon('close'));
  const stage = h('div', { class: 'viewer-img' }, img);
  const root = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo' },
    h('div', { class: 'viewer-top' }, btnClose, counter, btnShare, btnDel),
    stage,
    h('div', { class: 'viewer-bottom' },
      h('label', { class: 'visually-hidden', for: 'photo-caption' }, 'Légende'), caption, meta,
      h('div', { class: 'btn-row' }, btnLocate, btnPlace)));

  const render = () => {
    const p = photos[i];
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(p.blob);
    img.src = url;
    img.alt = p.caption || 'Photo de balade';
    caption.value = p.caption || '';
    counter.textContent = `${i + 1} / ${photos.length}`;
    const how = { gps: 'position GPS de la photo', heure: 'position estimée d’après l’heure', position: 'position au moment de la prise', manuel: 'position placée à la main' }[p.placedBy] || '';
    meta.textContent = [p.time ? fmtDateTime(p.time) : null, p.lon != null ? how : 'pas encore placée sur la carte'].filter(Boolean).join(' · ');
    btnLocate.hidden = p.lon == null;
    btnShare.hidden = !(navigator.canShare && navigator.canShare({ files: [new File([p.blob], 'photo.jpg', { type: 'image/jpeg' })] }));
  };
  let release;
  const close = (fromBack) => {
    if (url) URL.revokeObjectURL(url);
    root.remove();
    if (!fromBack) release?.();
  };
  release = pushBack(() => close(true));
  btnClose.onclick = () => close(false);
  caption.addEventListener('change', async () => {
    photos[i].caption = caption.value.trim();
    await savePhoto(photos[i]);
  });
  btnLocate.onclick = () => { const p = photos[i]; close(false); onLocate?.(p); };
  btnPlace.onclick = () => { const p = photos[i]; close(false); onPlace?.(p); };
  btnShare.onclick = async () => {
    const p = photos[i];
    try { await navigator.share({ files: [new File([p.blob], 'lacets-photo.jpg', { type: 'image/jpeg' })], text: p.caption || '' }); } catch { /* partage annulé */ }
  };
  btnDel.onclick = async () => {
    if (!(await confirmBox({ title: 'Supprimer cette photo ?', text: 'Elle sera retirée de ce parcours.', ok: 'Supprimer', danger: true }))) return;
    await deletePhoto(photos[i]);
    photos.splice(i, 1);
    if (!photos.length) { close(false); return; }
    i = Math.min(i, photos.length - 1);
    render();
  };
  let x0 = null;
  stage.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 60) { i = (i + (dx < 0 ? 1 : -1) + photos.length) % photos.length; render(); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { i = (i + 1) % photos.length; render(); }
    if (e.key === 'ArrowLeft') { i = (i - 1 + photos.length) % photos.length; render(); }
    if (e.key === 'Escape') close(false);
  });
  document.getElementById('app').append(root);
  render();
  btnClose.focus();
}
