// Communauté : sorties proposées, photos, alertes route. Deux modes :
// démo (données d'exemple sur ce téléphone) ou partagé via un projet Supabase gratuit.
import { app, emit, on } from './state.js';
import {
  h, icon, clear, toast, Sheet, segmented, openModal, confirmBox, fmtDateTime, fmtMonth, relTime, fmtKm, fmtEle,
  fmtDist, pickFiles, uid, pushBack, svgEl, plural, switchRow,
} from './ui.js';
import { kv, getItem, getGeom, saveItem } from './db.js';
import { setData, clearData, addMarker, fitBounds, flyTo, lineFeature } from './mapview.js';
import { compressImage } from './photos.js';
import { readExif } from './exif.js';
import { simplifyTo, flatten, computeStats, previewOf, dist } from './geo.js';
import * as loc from './location.js';
import { getItems } from './library.js';
import { planner } from './planner.js';

/* ---------- types d'alertes (panneaux de danger) ---------- */
export const ALERT_KINDS = {
  gravillons: { label: 'Gravillons', glyph: '<circle cx="13" cy="25" r="1.6"/><circle cx="18" cy="22" r="1.6"/><circle cx="22" cy="26" r="1.6"/><circle cx="27" cy="23" r="1.6"/><circle cx="16" cy="28" r="1.4"/><circle cx="25" cy="28" r="1.4"/><circle cx="20" cy="18" r="1.4"/>' },
  huile: { label: 'Huile ou gasoil', glyph: '<path d="M20 13c-4 6-5.5 8.5-5.5 11a5.5 5.5 0 0 0 11 0c0-2.5-1.5-5-5.5-11z"/>' },
  glissant: { label: 'Chaussée glissante', glyph: '<path d="M15 29c3-3 0-6 3-9s5-2 6-5" fill="none" stroke="#16191d" stroke-width="2"/><path d="M20 29c3-3 0-6 3-9s5-2 6-5" fill="none" stroke="#16191d" stroke-width="2"/>' },
  nid: { label: 'Nid-de-poule', glyph: '<path d="M10 25h6c1 3 7 3 8 0h6" fill="none" stroke="#16191d" stroke-width="2.4"/><ellipse cx="20" cy="26" rx="3.4" ry="1.6"/>' },
  travaux: { label: 'Travaux', glyph: '<circle cx="21" cy="14.5" r="2"/><path d="M20 17l-3 6 4 1 1 5M17 23l-3 6M21 20l4 2" fill="none" stroke="#16191d" stroke-width="2"/><path d="M24 29h6l-3-4z"/>' },
  fermee: { label: 'Route fermée', glyph: '<rect x="11" y="20" width="18" height="6" rx="1"/>' },
  animaux: { label: 'Animaux', glyph: '<path d="M14 28l1-6 6-2 4 2 1-4 2-3M26 15l3-2M27 18l3 1M15 22l-2-3M19 21v7M23 22v6" fill="none" stroke="#16191d" stroke-width="2"/>' },
  accident: { label: 'Accident', glyph: '<rect x="18.5" y="13" width="3" height="10" rx="1"/><circle cx="20" cy="27" r="1.8"/>' },
  autre: { label: 'Autre danger', glyph: '<rect x="18.5" y="13" width="3" height="10" rx="1"/><circle cx="20" cy="27" r="1.8"/>' },
};
export const alertLabel = (k) => ALERT_KINDS[k]?.label || 'Danger';
export function alertSvg(kind, size = 36) {
  const k = ALERT_KINDS[kind] || ALERT_KINDS.autre;
  return `<svg viewBox="0 0 40 35" width="${size}" height="${Math.round(size * 0.875)}" aria-hidden="true"><path d="M20 3 37.5 32.5h-35z" fill="#fff" stroke="#d7262e" stroke-width="3.6" stroke-linejoin="round"/><g fill="#16191d">${k.glyph}</g></svg>`;
}
const PACES = { cool: 'Cool', dynamique: 'Dynamique', sportif: 'Sportif' };

/* ---------- photos d'exemple dessinées ---------- */
const demoImages = new Map();
async function demoImage(seed) {
  if (demoImages.has(seed)) return demoImages.get(seed);
  const palettes = [
    ['#f7b267', '#f4845f', '#3d405b', '#5a5f7d', '#2b2d42'],
    ['#a8dadc', '#e9f5db', '#52796f', '#354f52', '#2f3e46'],
    ['#ffd6a5', '#f6bd60', '#84a59d', '#6b705c', '#3a3a3a'],
  ];
  const [skyA, skyB, m1, m2, road] = palettes[seed % palettes.length];
  const c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, skyA); sky.addColorStop(1, skyB);
  x.fillStyle = sky; x.fillRect(0, 0, 640, 480);
  x.fillStyle = 'rgba(255,255,255,.75)'; x.beginPath(); x.arc(470 - seed * 90, 110, 34, 0, Math.PI * 2); x.fill();
  const ridge = (base, amp, color, phase) => {
    x.fillStyle = color; x.beginPath(); x.moveTo(0, 480);
    for (let i = 0; i <= 640; i += 16) x.lineTo(i, base - amp * Math.abs(Math.sin(i / 90 + phase)) - 20 * Math.sin(i / 37 + phase * 2));
    x.lineTo(640, 480); x.fill();
  };
  ridge(270, 90, m1, seed); ridge(330, 60, m2, seed + 1.7);
  x.strokeStyle = road; x.lineWidth = 34; x.lineCap = 'round';
  x.beginPath(); x.moveTo(120, 480); x.bezierCurveTo(420, 430, 140, 390, 360, 350); x.bezierCurveTo(470, 330, 380, 315, 430, 300); x.stroke();
  x.strokeStyle = '#f1f1f1'; x.lineWidth = 3; x.setLineDash([16, 14]);
  x.beginPath(); x.moveTo(120, 480); x.bezierCurveTo(420, 430, 140, 390, 360, 350); x.bezierCurveTo(470, 330, 380, 315, 430, 300); x.stroke();
  x.setLineDash([]);
  x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(16, 16, 92, 30);
  x.fillStyle = '#fff'; x.font = '600 18px Barlow, sans-serif'; x.fillText('Exemple', 28, 37);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  const url = URL.createObjectURL(blob);
  demoImages.set(seed, url);
  return url;
}

/* ---------- mode démo ---------- */
const day = 86400e3;
function at(daysFromNow, hh, mm) { const d = new Date(Date.now() + daysFromNow * day); d.setHours(hh, mm, 0, 0); return d.toISOString(); }
function seedDemo() {
  const ago = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();
  return {
    rides: [
      { id: 'demo-r1', title: 'Virolos dans les monts du Lyonnais', description: 'Boucle par les petites départementales, pause café à Saint-Martin-en-Haut. Plein fait avant le départ.', starts_at: at(4, 9, 30), meet_name: 'Col de la Luère, parking', meet_lat: 45.7457, meet_lon: 4.6533, pace: 'dynamique', distance_km: 118, gain_m: 1650, author_id: 'demo-max', author_name: 'Max (exemple)', participants: [{ id: 'demo-lea', name: 'Léa (exemple)' }, { id: 'demo-karim', name: 'Karim (exemple)' }], demo: true },
      { id: 'demo-r2', title: 'Balade cool dans les Pierres Dorées', description: 'Rythme tranquille, idéal pour les permis A2. Retour avant 18 h.', starts_at: at(11, 14, 0), meet_name: 'Oingt, parking du village', meet_lat: 45.9472, meet_lon: 4.5845, pace: 'cool', distance_km: 86, gain_m: 980, author_id: 'demo-lea', author_name: 'Léa (exemple)', participants: [], demo: true },
      { id: 'demo-r3', title: 'Cols du Pilat', description: 'Montée par la Croix de Chaubouret, descente sur Pélussin.', starts_at: at(-3, 8, 45), meet_name: 'Col de la République', meet_lat: 45.3533, meet_lon: 4.4778, pace: 'sportif', distance_km: 142, gain_m: 2400, author_id: 'demo-karim', author_name: 'Karim (exemple)', participants: [{ id: 'demo-max', name: 'Max (exemple)' }], demo: true },
    ],
    posts: [
      { id: 'demo-p1', caption: 'Lever de soleil au-dessus de la vallée', created_at: ago(2), author_id: 'demo-lea', author_name: 'Léa (exemple)', lat: 45.7457, lon: 4.6533, demoSeed: 0, demo: true },
      { id: 'demo-p2', caption: 'Pause café avant les lacets du Pilat', created_at: ago(27), author_id: 'demo-karim', author_name: 'Karim (exemple)', lat: 45.3533, lon: 4.4778, demoSeed: 1, demo: true },
      { id: 'demo-p3', caption: 'Les vignes du Beaujolais en automne', created_at: ago(75), author_id: 'demo-max', author_name: 'Max (exemple)', lat: 45.9472, lon: 4.5845, demoSeed: 2, demo: true },
    ],
    alerts: [
      { id: 'demo-a1', kind: 'gravillons', note: 'Gravillons fraîchement posés dans les épingles', lat: 45.7481, lon: 4.6702, created_at: ago(5), expires_at: new Date(Date.now() + 2 * day).toISOString(), author_id: 'demo-max', author_name: 'Max (exemple)', demo: true },
      { id: 'demo-a2', kind: 'travaux', note: 'Alternat par feux, compte 5 minutes d’attente', lat: 45.8603, lon: 4.6845, created_at: ago(20), expires_at: new Date(Date.now() + 5 * day).toISOString(), author_id: 'demo-lea', author_name: 'Léa (exemple)', demo: true },
      { id: 'demo-a3', kind: 'animaux', note: 'Chevreuils à la tombée de la nuit', lat: 45.3807, lon: 4.5874, created_at: ago(48), expires_at: new Date(Date.now() + 7 * day).toISOString(), author_id: 'demo-karim', author_name: 'Karim (exemple)', demo: true },
    ],
  };
}

class DemoBackend {
  constructor(pseudo) { this.mode = 'demo'; this.me = { id: 'moi', name: pseudo || 'Moi' }; }
  async init() {
    this.data = (await kv.get('community-demo')) || seedDemo();
    await this.save();
  }
  save() { return kv.set('community-demo', this.data); }
  async listRides() { return this.data.rides.slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at)); }
  async createRide(r) { const row = { ...r, id: uid(), author_id: this.me.id, author_name: this.me.name, participants: [], created_at: new Date().toISOString() }; this.data.rides.push(row); await this.save(); return row; }
  async setJoin(id, join) {
    const r = this.data.rides.find((x) => x.id === id);
    if (!r) return;
    r.participants = r.participants.filter((p) => p.id !== this.me.id);
    if (join) r.participants.push({ id: this.me.id, name: this.me.name });
    await this.save();
  }
  async deleteRide(id) { this.data.rides = this.data.rides.filter((r) => r.id !== id); await this.save(); }
  async listPosts() { return this.data.posts.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async createPost({ caption, blob, lat, lon }) {
    const id = uid();
    await kv.set(`community-demo-photo-${id}`, blob);
    this.data.posts.push({ id, caption, lat, lon, created_at: new Date().toISOString(), author_id: this.me.id, author_name: this.me.name, localPhoto: true });
    await this.save();
  }
  async deletePost(p) { this.data.posts = this.data.posts.filter((x) => x.id !== p.id); await kv.del(`community-demo-photo-${p.id}`).catch(() => {}); await this.save(); }
  async photoUrl(p) {
    if (p.demoSeed != null) return demoImage(p.demoSeed);
    const blob = await kv.get(`community-demo-photo-${p.id}`);
    return blob ? URL.createObjectURL(blob) : null;
  }
  async listAlerts() { const now = new Date().toISOString(); return this.data.alerts.filter((a) => a.expires_at > now).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async createAlert(a) { this.data.alerts.push({ ...a, id: uid(), created_at: new Date().toISOString(), author_id: this.me.id, author_name: this.me.name }); await this.save(); }
  async deleteAlert(id) { this.data.alerts = this.data.alerts.filter((a) => a.id !== id); await this.save(); }
  async reset() { this.data = seedDemo(); await this.save(); }
}

/* ---------- mode partagé : Supabase ---------- */
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.supabase?.createClient) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Bibliothèque Supabase introuvable'));
    document.head.append(s);
  });
}

class SupabaseBackend {
  constructor(cfg) { this.mode = 'supabase'; this.cfg = cfg; }
  async init() {
    await loadScript('vendor/supabase.js');
    this.sb = window.supabase.createClient(this.cfg.url.replace(/\/+$/, ''), this.cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lacets-supabase-auth' },
    });
    let { data: { session } } = await this.sb.auth.getSession();
    if (!session) {
      const { data, error } = await this.sb.auth.signInAnonymously();
      if (error) throw new Error(/disabled/i.test(error.message) ? 'Active « Anonymous sign-ins » dans Supabase (Authentication → Sign In / Providers).' : error.message);
      session = data.session;
    }
    this.me = { id: session.user.id, name: this.cfg.pseudo || 'Motard' };
  }
  check({ error, data }) { if (error) throw new Error(error.message || 'Erreur Supabase'); return data; }
  async listRides() {
    const since = new Date(Date.now() - 7 * day).toISOString();
    const rows = this.check(await this.sb.from('rides').select('*, ride_participants(user_id, user_name)').gte('starts_at', since).order('starts_at', { ascending: true }).limit(100));
    return rows.map((r) => ({ ...r, participants: (r.ride_participants || []).map((p) => ({ id: p.user_id, name: p.user_name })) }));
  }
  async createRide(r) {
    const row = { ...r, author_id: this.me.id, author_name: this.me.name };
    delete row.participants;
    return this.check(await this.sb.from('rides').insert(row).select().single());
  }
  async setJoin(id, join) {
    if (join) this.check(await this.sb.from('ride_participants').upsert({ ride_id: id, user_id: this.me.id, user_name: this.me.name }));
    else this.check(await this.sb.from('ride_participants').delete().eq('ride_id', id).eq('user_id', this.me.id));
  }
  async deleteRide(id) { this.check(await this.sb.from('rides').delete().eq('id', id)); }
  async listPosts() { return this.check(await this.sb.from('posts').select('*').order('created_at', { ascending: false }).limit(60)); }
  async createPost({ caption, blob, lat, lon }) {
    const path = `${this.me.id}/${uid()}.jpg`;
    this.check(await this.sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
    this.check(await this.sb.from('posts').insert({ caption, photo_path: path, lat, lon, author_id: this.me.id, author_name: this.me.name }));
  }
  async deletePost(p) {
    await this.sb.storage.from('photos').remove([p.photo_path]);
    this.check(await this.sb.from('posts').delete().eq('id', p.id));
  }
  async photoUrl(p) { return this.sb.storage.from('photos').getPublicUrl(p.photo_path).data.publicUrl; }
  async listAlerts() { return this.check(await this.sb.from('alerts').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(300)); }
  async createAlert(a) { this.check(await this.sb.from('alerts').insert({ ...a, author_id: this.me.id, author_name: this.me.name })); }
  async deleteAlert(id) { this.check(await this.sb.from('alerts').delete().eq('id', id)); }
}

/* ---------- état et interface ---------- */
let backend = null, backendError = null;
let tab = 'sorties';
let data = { rides: [], posts: [], alerts: [] };
let panel, body, badge, banner, createBtn, segEl;
let sheet, sd = {}, curRide = null, releaseRide = null, meetMarker = null;
let alertMarkers = [];
const photoUrls = new Map();

const friendly = (e) => (/fetch|network|load failed|tunnel/i.test(e?.message || String(e))
  ? 'Projet Supabase injoignable : vérifie l’adresse du projet et ta connexion.'
  : /invalid api key|jwt|apikey/i.test(e?.message || '') ? 'Clé refusée par Supabase : recopie la clé publique (publishable ou anon) du projet.'
    : (e?.message || String(e)));

async function connect() {
  const cfg = await kv.get('community-config');
  backendError = null;
  try {
    if (cfg?.url && cfg?.key) { const b = new SupabaseBackend(cfg); await b.init(); backend = b; }
    else { const b = new DemoBackend(cfg?.pseudo); await b.init(); backend = b; }
  } catch (e) {
    backendError = friendly(e);
    const b = new DemoBackend(cfg?.pseudo);
    await b.init();
    backend = b;
  }
}

async function refresh() {
  if (!backend) await connect();
  try {
    const [rides, posts, alerts] = await Promise.all([backend.listRides(), backend.listPosts(), backend.listAlerts()]);
    data = { rides, posts, alerts };
  } catch (e) {
    backendError = friendly(e);
  }
  render();
  drawAlertMarkers();
}

export const activeAlerts = () => data.alerts;

function drawAlertMarkers() {
  alertMarkers.forEach((m) => m.remove());
  alertMarkers = [];
  if (!app.map || app.settings.showAlerts === false) return;
  for (const a of data.alerts) {
    const el = h('button', { class: 'mk-alert', type: 'button', 'aria-label': alertLabel(a.kind), html: alertSvg(a.kind, 36) });
    el.addEventListener('click', (e) => { e.stopPropagation(); toast(`${alertLabel(a.kind)}${a.note ? ' : ' + a.note : ''} · ${relTime(a.created_at)}`, { timeout: 6000 }); });
    alertMarkers.push(addMarker(el, [a.lon, a.lat], { anchor: 'bottom' }));
  }
}

function buildPanel(root) {
  badge = h('span', { class: 'badge' });
  const gear = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Réglages du partage' }, icon('gear'));
  gear.onclick = configure;
  segEl = segmented([['sorties', 'Sorties'], ['photos', 'Photos'], ['alertes', 'Alertes']], tab, (v) => { tab = v; render(); }, { label: 'Rubrique' });
  banner = h('div', { class: 'banner', hidden: true });
  body = h('div', { class: 'feed' });
  createBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', style: { position: 'absolute', right: '14px', bottom: '14px', boxShadow: 'var(--shadow)', zIndex: 2 } });
  createBtn.onclick = () => (tab === 'sorties' ? newRide() : tab === 'photos' ? newPost() : newAlert());
  panel = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('div', { class: 'panel-head-row' }, h('h1', {}, 'Communauté'), badge, gear), segEl),
    h('div', { class: 'panel-body', style: { position: 'relative', paddingBottom: '84px' } }, banner, body),
    createBtn);
  root.append(panel);
}

function render() {
  if (!body) return;
  const demo = backend?.mode !== 'supabase';
  badge.textContent = demo ? 'Démo' : 'Partagé';
  badge.className = 'badge' + (demo ? ' demo' : '');
  clear(banner);
  banner.hidden = false;
  if (backendError) {
    banner.append(h('b', {}, 'Connexion au partage impossible'), h('p', {}, backendError), h('p', { class: 'small' }, 'En attendant, tu vois les exemples du mode démo.'));
    const b = h('button', { class: 'btn', type: 'button' }, 'Vérifier les réglages'); b.onclick = configure; banner.append(b);
  } else if (demo) {
    banner.append(h('p', {}, 'Mode démo : les publications marquées « exemple » sont fictives et rien ne quitte ce téléphone. Branche un projet Supabase gratuit pour partager sorties, photos et alertes avec tes potes.'));
    const b = h('button', { class: 'btn', type: 'button' }, icon('users'), 'Configurer le partage'); b.onclick = configure; banner.append(b);
  } else banner.hidden = true;
  clear(body);
  createBtn.textContent = '';
  createBtn.append(icon('plus'), tab === 'sorties' ? 'Proposer une sortie' : tab === 'photos' ? 'Publier une photo' : 'Signaler un danger');
  if (tab === 'sorties') renderRides();
  if (tab === 'photos') renderPosts();
  if (tab === 'alertes') renderAlerts();
}

const isMine = (row) => row.author_id === backend?.me.id;
const joined = (r) => r.participants?.some((p) => p.id === backend?.me.id);

function rideCard(r) {
  const past = new Date(r.starts_at) < Date.now() - 6 * 3600e3;
  const join = h('button', { class: 'btn' + (joined(r) ? ' btn-dark' : ''), type: 'button', disabled: past }, icon(joined(r) ? 'check' : 'plus'), joined(r) ? 'Je viens' : 'Je participe');
  join.onclick = async (e) => { e.stopPropagation(); await toggleJoin(r); };
  const see = h('button', { class: 'btn', type: 'button' }, icon('map'), 'Voir');
  see.onclick = () => openRide(r);
  const d = new Date(r.starts_at);
  return h('article', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'date-block' + (past ? ' past' : ''), 'aria-hidden': 'true' }, h('div', { class: 'm' }, fmtMonth(d)), h('div', { class: 'd' }, d.getDate())),
      h('div', {}, h('h3', {}, r.title), h('p', { class: 'small muted' }, `${fmtDateTime(r.starts_at)} · RDV ${r.meet_name || 'à préciser'}`))),
    h('div', { class: 'row-meta' },
      r.pace ? h('span', { class: `badge pace-${r.pace}` }, PACES[r.pace]) : null,
      r.distance_km ? h('span', { class: 'num' }, fmtKm(r.distance_km * 1000)) : null,
      r.gain_m ? h('span', { class: 'num' }, `D+ ${fmtEle(r.gain_m)}`) : null,
      h('span', {}, plural(r.participants?.length || 0, 'participant', 'participants')),
      r.demo ? h('span', { class: 'badge demo' }, 'exemple') : null,
      past ? h('span', { class: 'badge' }, 'passée') : null),
    r.description ? h('p', { class: 'small' }, r.description) : null,
    h('p', { class: 'small muted' }, `Proposée par ${isMine(r) ? 'toi' : r.author_name}`),
    h('div', { class: 'btn-row' }, join, see));
}

function renderRides() {
  if (!data.rides.length) { body.append(h('div', { class: 'empty' }, h('h2', {}, 'Aucune sortie prévue'), h('p', { class: 'muted' }, 'Propose la première : date, lieu de rendez-vous et parcours.'))); return; }
  // sorties à venir d'abord (la plus proche en tête), puis les sorties passées
  const cut = Date.now() - 6 * 3600e3;
  const upcoming = data.rides.filter((r) => new Date(r.starts_at) >= cut);
  const past = data.rides.filter((r) => new Date(r.starts_at) < cut).reverse();
  for (const r of [...upcoming, ...past]) body.append(rideCard(r));
}

async function renderPosts() {
  if (!data.posts.length) { body.append(h('div', { class: 'empty' }, h('h2', {}, 'Pas encore de photos'), h('p', { class: 'muted' }, 'Publie un beau point de vue de ta dernière balade.'))); return; }
  for (const p of data.posts) {
    const img = h('img', { class: 'post-img', alt: p.caption || 'Photo de balade', loading: 'lazy' });
    const card = h('article', { class: 'card' }, img,
      p.caption ? h('p', {}, p.caption) : null,
      h('p', { class: 'small muted' }, `${isMine(p) ? 'Toi' : p.author_name} · ${relTime(p.created_at)}`, p.demo ? ' · exemple' : ''));
    const row = h('div', { class: 'btn-row' });
    if (p.lat != null) { const b = h('button', { class: 'btn', type: 'button' }, icon('pin'), 'Voir sur la carte'); b.onclick = () => showOnMap([p.lon, p.lat]); row.append(b); }
    if (isMine(p)) { const b = h('button', { class: 'btn btn-ghost', type: 'button' }, icon('trash'), 'Supprimer'); b.onclick = async () => { if (await confirmBox({ title: 'Supprimer ta photo ?', ok: 'Supprimer', danger: true })) { await backend.deletePost(p); refresh(); } }; row.append(b); }
    if (row.children.length) card.append(row);
    body.append(card);
    const cached = photoUrls.get(p.id);
    if (cached) img.src = cached;
    else backend.photoUrl(p).then((u) => { if (u) { photoUrls.set(p.id, u); img.src = u; } }).catch(() => {});
  }
}

function renderAlerts() {
  if (!data.alerts.length) { body.append(h('div', { class: 'empty' }, h('h2', {}, 'Aucune alerte en cours'), h('p', { class: 'muted' }, 'Signale gravillons, travaux ou animaux : tes potes seront prévenus à l’approche.'))); return; }
  const me = loc.lastPosition();
  const list = data.alerts.map((a) => ({ a, d: me ? dist([me.lon, me.lat], [a.lon, a.lat]) : null }));
  if (me) list.sort((x, y) => x.d - y.d);
  for (const { a, d } of list) {
    const left = Math.max(0, new Date(a.expires_at) - Date.now());
    const card = h('article', { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { html: alertSvg(a.kind, 40) }),
        h('div', {}, h('h3', {}, alertLabel(a.kind)), a.note ? h('p', { class: 'small' }, a.note) : null)),
      h('p', { class: 'small muted' }, [d != null ? `à ${fmtDist(d)}` : null, `signalé ${relTime(a.created_at)} par ${isMine(a) ? 'toi' : a.author_name}`, `encore ${left > day ? plural(Math.round(left / day), 'jour', 'jours') : plural(Math.max(1, Math.round(left / 3600e3)), 'heure', 'heures')}`, a.demo ? 'exemple' : null].filter(Boolean).join(' · ')));
    const row = h('div', { class: 'btn-row' });
    const see = h('button', { class: 'btn', type: 'button' }, icon('pin'), 'Voir sur la carte');
    see.onclick = () => showOnMap([a.lon, a.lat]);
    row.append(see);
    if (isMine(a)) { const b = h('button', { class: 'btn btn-ghost', type: 'button' }, icon('trash'), 'Retirer'); b.onclick = async () => { await backend.deleteAlert(a.id); refresh(); }; row.append(b); }
    card.append(row);
    body.append(card);
  }
}

function showOnMap(lngLat) {
  emit('show-screen', 'carte');
  setTimeout(() => flyTo(lngLat, 14), 50);
}

async function toggleJoin(r) {
  try { await backend.setJoin(r.id, !joined(r)); toast(joined(r) ? 'Participation retirée.' : 'C’est noté, à bientôt sur la route !'); }
  catch (e) { toast(e.message, { error: true }); }
  await refresh();
  if (curRide?.id === r.id) openRide(data.rides.find((x) => x.id === r.id) || r);
}

/* ---------- fiche sortie ---------- */
function buildSheet(root) {
  sheet = new Sheet({ peek: 190, half: 0.52, full: 0.92, initial: 'half', onSnap: () => emit('insets-changed') });
  sheet.el.hidden = true;
  root.append(sheet.el);
  sd.back = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Retour' }, icon('back'));
  sd.back.onclick = () => closeRide(false);
  sd.title = h('h2', {});
  sd.when = h('p', { class: 'muted small' });
  sheet.head.append(h('div', { class: 'sheet-title-row' }, sd.back, sd.title), sd.when);
}

function openRide(r) {
  curRide = r;
  if (!releaseRide) releaseRide = pushBack(() => { releaseRide = null; closeRide(true); });
  panel.hidden = true;
  sheet.el.hidden = false;
  document.body.classList.add('has-sheet');
  sd.title.textContent = r.title;
  sd.when.textContent = `${fmtDateTime(r.starts_at)} · ${PACES[r.pace] || ''}`;
  clear(sheet.body);
  const join = h('button', { class: 'btn btn-lg' + (joined(r) ? ' btn-dark' : ' btn-primary'), type: 'button' }, icon(joined(r) ? 'check' : 'plus'), joined(r) ? 'Je viens (annuler)' : 'Je participe');
  join.onclick = () => toggleJoin(r);
  const go = h('button', { class: 'btn btn-lg', type: 'button' }, icon('nav'), 'Itinéraire jusqu’au RDV');
  go.onclick = () => { closeRide(false); planner.routeTo(r.meet_lon, r.meet_lat, r.meet_name || 'Rendez-vous'); };
  const actions = h('div', { class: 'btn-row' }, join, r.meet_lat != null ? go : null);
  sheet.body.append(
    actions,
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, r.distance_km ? fmtKm(r.distance_km * 1000) : '–'), h('span', {}, 'Distance')),
      h('div', { class: 'stat' }, h('b', {}, r.gain_m ? fmtEle(r.gain_m) : '–'), h('span', {}, 'Dénivelé +')),
      h('div', { class: 'stat' }, h('b', {}, String(r.participants?.length || 0)), h('span', {}, 'Participants'))),
    h('section', {}, h('h3', { class: 'section-title' }, 'Rendez-vous'), h('p', {}, r.meet_name || 'Lieu à préciser')),
    r.description ? h('section', {}, h('h3', { class: 'section-title' }, 'Programme'), h('p', {}, r.description)) : null,
    h('section', {}, h('h3', { class: 'section-title' }, 'Participants'),
      h('p', {}, [r.author_name + ' (organise)', ...(r.participants || []).map((p) => (p.id === backend.me.id ? 'toi' : p.name))].join(', '))),
  );
  if (r.route?.length > 1) {
    const copy = h('button', { class: 'btn', type: 'button' }, icon('download'), 'Copier le parcours dans mes parcours');
    copy.onclick = () => copyRoute(r);
    sheet.body.append(copy);
  } else {
    sheet.body.append(h('p', { class: 'hint' }, 'Pas de parcours joint à cette sortie.'));
  }
  if (isMine(r) && !r.demo) {
    const del = h('button', { class: 'btn btn-ghost', type: 'button', style: { color: 'var(--brake)' } }, icon('trash'), 'Annuler la sortie');
    del.onclick = async () => { if (await confirmBox({ title: 'Annuler cette sortie ?', text: 'Elle disparaîtra pour tout le monde.', ok: 'Annuler la sortie', danger: true })) { await backend.deleteRide(r.id); closeRide(false); refresh(); } };
    sheet.body.append(del);
  }
  sheet.setSnap('half');
  drawRide(r);
}

function drawRide(r) {
  meetMarker?.remove(); meetMarker = null;
  clearData('ov-comm');
  const pts = [];
  if (r.route?.length > 1) { setData('ov-comm', lineFeature(r.route)); pts.push(...r.route); }
  if (r.meet_lat != null) {
    meetMarker = addMarker(h('div', { class: 'mk-meet', title: r.meet_name || 'Rendez-vous' }, icon('flag', 'sm')), [r.meet_lon, r.meet_lat]);
    pts.push([r.meet_lon, r.meet_lat]);
  }
  if (pts.length) {
    let w = 180, s = 90, e = -180, n = -90;
    for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    setTimeout(() => (pts.length > 1 ? fitBounds([w, s, e, n], { maxZoom: 13 }) : flyTo(pts[0], 12)), 40);
  }
}

function closeRide(fromBack) {
  if (!fromBack && releaseRide) { const r = releaseRide; releaseRide = null; r(); }
  curRide = null;
  meetMarker?.remove(); meetMarker = null;
  clearData('ov-comm');
  if (!sheet) return;
  sheet.el.hidden = true;
  panel.hidden = false;
  document.body.classList.remove('has-sheet');
  emit('insets-changed');
}

async function copyRoute(r) {
  const coords = r.route.map((c) => [c[0], c[1], null, null]);
  const segments = [coords];
  const id = uid();
  await saveItem({
    id, kind: 'import', name: r.title, notes: r.description || '', stats: computeStats(segments), preview: previewOf(segments),
    date: r.starts_at, source: { filename: 'Sortie de la communauté', creator: r.author_name, type: 'trace' },
  }, { id, segments, pois: r.meet_lat != null ? [{ lon: r.meet_lon, lat: r.meet_lat, name: `RDV : ${r.meet_name || ''}` }] : [] });
  toast('Parcours copié dans tes parcours.', { action: 'Voir', onAction: () => emit('open-item', id) });
}

/* ---------- formulaires ---------- */
function positionPicker(initial) {
  const state = { pos: initial || null };
  const label = h('p', { class: 'small muted' });
  const show = () => { label.textContent = state.pos ? `Position : ${state.pos.lat.toFixed(5)}, ${state.pos.lon.toFixed(5)}${state.pos.src ? ` (${state.pos.src})` : ''}` : 'Pas de position choisie.'; };
  const me = h('button', { class: 'btn', type: 'button' }, icon('locate'), 'Ma position');
  me.onclick = async () => { try { const p = await loc.once(); state.pos = { lon: p.lon, lat: p.lat, src: 'ma position' }; show(); } catch (e) { toast(loc.errorText(e), { error: true }); } };
  const center = h('button', { class: 'btn', type: 'button' }, icon('map'), 'Centre de la carte');
  center.onclick = () => { const c = app.map.getCenter(); state.pos = { lon: c.lng, lat: c.lat, src: 'centre de la carte' }; show(); };
  show();
  return { el: h('div', { class: 'field' }, h('span', {}, 'Emplacement'), h('div', { class: 'btn-row' }, me, center), label), get: () => state.pos };
}

async function newRide(prefill = null) {
  const items = getItems().filter((m) => m.stats?.distance > 0);
  const res = await openModal((box, done) => {
    const title = h('input', { class: 'input', id: 'ride-title', required: true, value: prefill ? prefill.meta.name : '', placeholder: 'Ex. Virolos dans le Pilat' });
    const tomorrow = new Date(Date.now() + day);
    const date = h('input', { class: 'input', id: 'ride-date', type: 'date', required: true, value: tomorrow.toISOString().slice(0, 10) });
    const time = h('input', { class: 'input', id: 'ride-time', type: 'time', required: true, value: '09:30' });
    const meet = h('input', { class: 'input', id: 'ride-meet', placeholder: 'Ex. Station essence de Brindas' });
    const pos = positionPicker(prefill ? (() => { const s = prefill.geom.segments?.[0]?.[0]; return s ? { lon: s[0], lat: s[1], src: 'départ du parcours' } : null; })() : null);
    const pace = h('select', { class: 'input', id: 'ride-pace' }, Object.entries(PACES).map(([k, v]) => h('option', { value: k, selected: k === 'dynamique' }, v)));
    const route = h('select', { class: 'input', id: 'ride-route' }, h('option', { value: '' }, 'Aucun parcours'),
      items.map((m) => h('option', { value: m.id, selected: prefill?.meta.id === m.id }, `${m.name} (${fmtKm(m.stats.distance)})`)));
    const desc = h('textarea', { class: 'input', id: 'ride-desc', placeholder: 'Programme, pauses, niveau attendu…' });
    const form = h('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      if (!title.value.trim()) { title.focus(); return; }
      done({ title: title.value.trim(), when: new Date(`${date.value}T${time.value || '09:00'}`), meet: meet.value.trim(), pos: pos.get(), pace: pace.value, routeId: route.value, desc: desc.value.trim() });
    } },
      h('h2', {}, 'Proposer une sortie'),
      h('label', { class: 'field', for: 'ride-title' }, h('span', {}, 'Titre'), title),
      h('div', { class: 'btn-row' }, h('label', { class: 'field', for: 'ride-date', style: { flex: 1 } }, h('span', {}, 'Date'), date), h('label', { class: 'field', for: 'ride-time', style: { flex: 1 } }, h('span', {}, 'Heure'), time)),
      h('label', { class: 'field', for: 'ride-meet' }, h('span', {}, 'Lieu de rendez-vous'), meet),
      pos.el,
      h('label', { class: 'field', for: 'ride-pace' }, h('span', {}, 'Rythme'), pace),
      h('label', { class: 'field', for: 'ride-route' }, h('span', {}, 'Parcours'), route),
      h('label', { class: 'field', for: 'ride-desc' }, h('span', {}, 'Programme'), desc),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-lg', type: 'button', onClick: () => done(null) }, 'Annuler'), h('button', { class: 'btn btn-lg btn-primary', type: 'submit' }, 'Publier la sortie')));
    box.append(form);
  });
  if (!res) return;
  const row = { title: res.title, description: res.desc, starts_at: res.when.toISOString(), meet_name: res.meet || null, meet_lat: res.pos?.lat ?? null, meet_lon: res.pos?.lon ?? null, pace: res.pace, route: null, distance_km: null, gain_m: null };
  if (res.routeId) {
    const meta = await getItem(res.routeId);
    const geom = await getGeom(res.routeId);
    const flat = flatten(geom?.segments || []).map((c) => [+c[0].toFixed(5), +c[1].toFixed(5)]);
    row.route = simplifyTo(flat, 600);
    row.distance_km = Math.round((meta.stats?.distance || 0) / 100) / 10;
    row.gain_m = meta.stats?.gain != null ? Math.round(meta.stats.gain) : null;
  }
  try { await backend.createRide(row); toast('Sortie publiée.'); tab = 'sorties'; segEl.setValue('sorties'); await refresh(); }
  catch (e) { toast(`Publication impossible : ${e.message}`, { error: true }); }
}

async function newPost() {
  const files = await pickFiles({ accept: 'image/*', multiple: false });
  if (!files.length) return;
  const file = files[0];
  let ex = {};
  try { ex = readExif(await file.arrayBuffer()) || {}; } catch { /* sans EXIF */ }
  let comp;
  try { comp = await compressImage(file, 1600, 0.8); } catch { toast('Image illisible.', { error: true }); return; }
  const preview = URL.createObjectURL(comp.blob);
  const res = await openModal((box, done) => {
    const caption = h('input', { class: 'input', id: 'post-caption', placeholder: 'Une légende ?', maxlength: '200' });
    let withPos = ex.lat != null;
    const posSwitch = switchRow('post-pos', 'Indiquer l’endroit', withPos, (v) => { withPos = v; }, ex.lat != null ? 'Position GPS de la photo' : 'Ta position actuelle');
    box.append(h('form', { class: 'form', onSubmit: (e) => { e.preventDefault(); done({ caption: caption.value.trim(), withPos }); } },
      h('h2', {}, 'Publier une photo'),
      h('img', { class: 'post-img', src: preview, alt: 'Aperçu' }),
      h('label', { class: 'field', for: 'post-caption' }, h('span', {}, 'Légende'), caption),
      posSwitch,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-lg', type: 'button', onClick: () => done(null) }, 'Annuler'), h('button', { class: 'btn btn-lg btn-primary', type: 'submit' }, 'Publier'))));
  });
  URL.revokeObjectURL(preview);
  if (!res) return;
  let lat = null, lon = null;
  if (res.withPos) {
    if (ex.lat != null) { lat = ex.lat; lon = ex.lon; }
    else { try { const p = await loc.once(); lat = p.lat; lon = p.lon; } catch { /* sans position */ } }
  }
  try { await backend.createPost({ caption: res.caption, blob: comp.blob, lat, lon }); toast('Photo publiée.'); await refresh(); }
  catch (e) { toast(`Publication impossible : ${e.message}`, { error: true }); }
}

async function newAlert(at = null) {
  let kind = null;
  const res = await openModal((box, done) => {
    const grid = h('div', { class: 'kind-grid', role: 'group', 'aria-label': 'Type de danger' },
      Object.entries(ALERT_KINDS).map(([k, v]) => {
        const b = h('button', { type: 'button', 'aria-pressed': 'false', html: alertSvg(k, 40) }, v.label);
        b.onclick = () => { kind = k; for (const c of grid.children) c.setAttribute('aria-pressed', String(c === b)); };
        return b;
      }));
    const note = h('input', { class: 'input', id: 'alert-note', placeholder: 'Précision (facultatif)', maxlength: '140' });
    const pos = positionPicker(at ? { lon: at.lon, lat: at.lat, src: 'ma position' } : null);
    let hours = 24;
    const dur = segmented([['24', '24 h'], ['72', '3 jours'], ['168', '7 jours']], '24', (v) => { hours = +v; }, { label: 'Durée' });
    const err = h('p', { class: 'leg-warn', hidden: true });
    box.append(h('form', { class: 'form', onSubmit: (e) => {
      e.preventDefault();
      const p = pos.get();
      if (!kind) { err.textContent = 'Choisis le type de danger.'; err.hidden = false; return; }
      if (!p) { err.textContent = 'Indique l’emplacement du danger.'; err.hidden = false; return; }
      done({ kind, note: note.value.trim(), pos: p, hours });
    } },
      h('h2', {}, 'Signaler un danger'), grid,
      h('label', { class: 'field', for: 'alert-note' }, h('span', {}, 'Précision'), note),
      pos.el,
      h('div', { class: 'field' }, h('span', {}, 'Durée d’affichage'), dur),
      err,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-lg', type: 'button', onClick: () => done(null) }, 'Annuler'), h('button', { class: 'btn btn-lg btn-danger', type: 'submit' }, icon('warn'), 'Signaler'))));
  });
  if (!res) return;
  try {
    await backend.createAlert({ kind: res.kind, note: res.note || null, lat: res.pos.lat, lon: res.pos.lon, expires_at: new Date(Date.now() + res.hours * 3600e3).toISOString() });
    toast('Merci, le danger est signalé.');
    await refresh();
  } catch (e) { toast(`Signalement impossible : ${e.message}`, { error: true }); }
}

async function configure() {
  const cfg = (await kv.get('community-config')) || {};
  const res = await openModal((box, done) => {
    const pseudo = h('input', { class: 'input', id: 'cfg-pseudo', value: cfg.pseudo || '', placeholder: 'Ton pseudo', maxlength: '40' });
    const url = h('input', { class: 'input', id: 'cfg-url', value: cfg.url || '', placeholder: 'https://xxxx.supabase.co', inputmode: 'url', autocomplete: 'off' });
    const key = h('input', { class: 'input', id: 'cfg-key', value: cfg.key || '', placeholder: 'sb_publishable_… ou clé anon', autocomplete: 'off' });
    box.append(h('form', { class: 'form', onSubmit: (e) => { e.preventDefault(); done({ pseudo: pseudo.value.trim(), url: url.value.trim(), key: key.value.trim() }); } },
      h('h2', {}, 'Partage avec tes potes'),
      h('p', {}, 'Crée un projet gratuit sur supabase.com, lance le script supabase/schema.sql fourni avec l’appli, active les connexions anonymes, puis colle ici l’adresse du projet et sa clé publique. Partage ces deux valeurs avec ton groupe.'),
      h('label', { class: 'field', for: 'cfg-pseudo' }, h('span', {}, 'Pseudo affiché'), pseudo),
      h('label', { class: 'field', for: 'cfg-url' }, h('span', {}, 'Adresse du projet Supabase'), url),
      h('label', { class: 'field', for: 'cfg-key' }, h('span', {}, 'Clé publique'), key),
      h('div', { class: 'action-list' },
        h('button', { class: 'btn btn-lg btn-primary', type: 'submit' }, 'Enregistrer et se connecter'),
        cfg.url ? h('button', { class: 'btn btn-lg', type: 'button', onClick: () => done({ pseudo: pseudo.value.trim(), url: '', key: '' }) }, 'Revenir au mode démo') : null,
        h('button', { class: 'btn btn-lg btn-ghost', type: 'button', onClick: () => done(null) }, 'Annuler'))));
  });
  if (!res) return;
  if (res.url && !/^https:\/\/.+/.test(res.url)) { toast('L’adresse doit commencer par https://', { error: true }); return; }
  await kv.set('community-config', res);
  backend = null;
  photoUrls.clear();
  await refresh();
  if (!backendError) toast(backend.mode === 'supabase' ? 'Connecté au partage.' : 'Mode démo activé.');
}

export const community = {
  id: 'communaute',
  mount(root) {
    buildPanel(root);
    buildSheet(root);
    app.activeAlerts = activeAlerts;
    app.alertLabel = alertLabel;
    on('quick-alert', (pos) => newAlert(pos));
    on('propose-ride', (p) => { emit('show-screen', 'communaute'); newRide(p); });
    on('settings-changed', () => drawAlertMarkers());
    on('style-loaded', () => drawAlertMarkers());
    refresh();
    setInterval(() => { if (navigator.onLine) refresh(); }, 5 * 60e3);
  },
  show() { if (curRide) { document.body.classList.add('has-sheet'); sheet.apply(); drawRide(curRide); } refresh(); },
  hide() { document.body.classList.remove('has-sheet'); if (curRide) { meetMarker?.remove(); meetMarker = null; clearData('ov-comm'); } },
  bottomInset() { return curRide ? sheet.visibleHeight : 0; },
  coversMap() { return !curRide; },
  refresh,
};
