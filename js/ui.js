// Petits outils d'interface : création d'éléments, formats français, toasts, modales, feuilles coulissantes.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendAll(el, children);
  return el;
}

export function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

const SVGNS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = '') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', ('i ' + cls).trim());
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}

export function svgEl(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- formats ---------- */
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dfDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dfDateLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dfDT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dfTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dfMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const rtf = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

const ok = (v) => v != null && Number.isFinite(v);
export const fmtInt = (v) => (ok(v) ? nf0.format(v) : '–');
export function kmValue(m) {
  if (!ok(m)) return '–';
  const km = m / 1000;
  return km < 100 ? nf1.format(km) : nf0.format(km);
}
export const fmtKm = (m) => (ok(m) ? kmValue(m) + ' km' : '–');
export function fmtDist(m) { // distances courtes (guidage)
  if (!ok(m)) return '–';
  if (m < 950) return nf0.format(m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50) + ' m';
  return (m < 10000 ? nf1.format(m / 1000) : nf0.format(m / 1000)) + ' km';
}
export function fmtDur(s) {
  if (!ok(s)) return '–';
  const tm = Math.round(s / 60);
  const hh = Math.floor(tm / 60), mm = tm % 60;
  return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm} min`;
}
export function fmtClock(s) {
  if (!ok(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
export const fmtSpeed = (kmh) => (ok(kmh) ? nf0.format(kmh) : '–');
export const fmtEle = (m) => (ok(m) ? nf0.format(m) + ' m' : '–');
export const fmtDate = (t) => (t ? dfDate.format(new Date(t)) : '');
export const fmtDateLong = (t) => (t ? dfDateLong.format(new Date(t)) : '');
export const fmtDateTime = (t) => (t ? dfDT.format(new Date(t)) : '');
export const fmtTime = (t) => (t ? dfTime.format(new Date(t)) : '');
export const fmtMonth = (t) => dfMonth.format(new Date(t)).replace('.', '');
export function relTime(t) {
  const diff = (new Date(t).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'à l’instant';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
export function plural(n, one, many) { return `${fmtInt(n)} ${n > 1 ? many : one}`; }

/* ---------- toasts ---------- */
export function toast(msg, { action, onAction, error = false, timeout = 4000 } = {}) {
  const root = document.getElementById('toasts');
  const el = h('div', { class: 'toast' + (error ? ' error' : ''), role: error ? 'alert' : 'status' }, h('span', {}, msg));
  if (action) el.append(h('button', { type: 'button', onClick: () => { el.remove(); onAction?.(); } }, action));
  root.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

/* ---------- bouton retour Android ---------- */
const backStack = [];
let ignorePop = 0;
export function pushBack(onBack) {
  const entry = { onBack, active: true };
  backStack.push(entry);
  try { history.pushState({ lacets: backStack.length }, ''); } catch { /* ignoré */ }
  return function release() {
    if (!entry.active) return;
    entry.active = false;
    const i = backStack.indexOf(entry);
    if (i >= 0) backStack.splice(i, 1);
    ignorePop++;
    history.back();
  };
}
window.addEventListener('popstate', () => {
  if (ignorePop > 0) { ignorePop--; return; }
  const entry = backStack.pop();
  if (entry && entry.active) { entry.active = false; entry.onBack(); }
});

/* ---------- modales ---------- */
export function openModal(build, { dismissable = true } = {}) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    back.append(box);
    let done = false;
    let release = null;
    const finish = (val, fromBack = false) => {
      if (done) return;
      done = true;
      back.remove();
      if (!fromBack) release?.();
      resolve(val);
    };
    release = pushBack(() => finish(undefined, true));
    if (dismissable) back.addEventListener('click', (e) => { if (e.target === back) finish(undefined); });
    build(box, finish);
    document.getElementById('app').append(back);
    requestAnimationFrame(() => (box.querySelector('[autofocus]') || box.querySelector('input, textarea, select'))?.focus());
  });
}

export function confirmBox({ title, text, ok = 'Confirmer', cancel = 'Annuler', danger = false }) {
  return openModal((box, done) => {
    box.append(
      h('h2', {}, title),
      text ? h('p', {}, text) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-lg', type: 'button', onClick: () => done(false) }, cancel),
        h('button', { class: 'btn btn-lg ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', onClick: () => done(true) }, ok)),
    );
  }).then((v) => v === true);
}

export function promptBox({ title, label = '', value = '', placeholder = '', ok = 'Valider', multiline = false }) {
  return openModal((box, done) => {
    const input = multiline
      ? h('textarea', { class: 'input', id: 'prompt-input', placeholder, autofocus: true }, value)
      : h('input', { class: 'input', id: 'prompt-input', value, placeholder, autofocus: true, enterkeyhint: 'done' });
    const form = h('form', { class: 'form', onSubmit: (e) => { e.preventDefault(); done(input.value.trim()); } },
      h('h2', {}, title),
      h('label', { class: 'field', for: 'prompt-input' }, label ? h('span', {}, label) : null, input),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-lg', type: 'button', onClick: () => done(null) }, 'Annuler'),
        h('button', { class: 'btn btn-lg btn-primary', type: 'submit' }, ok)));
    box.append(form);
  }).then((v) => (v == null ? null : v));
}

export function actionSheet(title, actions) {
  return openModal((box, done) => {
    box.append(
      title ? h('h2', {}, title) : null,
      h('div', { class: 'action-list' },
        actions.filter(Boolean).map((a) => h('button', {
          class: 'btn btn-lg ' + (a.danger ? 'btn-danger' : a.primary ? 'btn-primary' : ''),
          type: 'button', onClick: () => done(a.key),
        }, a.icon ? icon(a.icon) : null, a.label)),
        h('button', { class: 'btn btn-lg btn-ghost', type: 'button', onClick: () => done(null) }, 'Annuler')),
    );
  });
}

/* ---------- contrôles ---------- */
export function segmented(options, value, onChange, { label } = {}) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label || null });
  const render = (v) => {
    for (const b of wrap.children) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  };
  for (const [v, text] of options) {
    wrap.append(h('button', { type: 'button', dataset: { v }, onClick: () => { render(v); onChange(v); } }, text));
  }
  render(value);
  wrap.setValue = render;
  return wrap;
}

export function switchRow(id, label, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', id, role: 'switch', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch', for: id },
    h('span', {}, label, hint ? h('span', { class: 'hint', style: { display: 'block' } }, hint) : null), input);
}

/* ---------- fichiers ---------- */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export function pickFiles({ accept = '', multiple = true, capture = null } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: accept || null, multiple, capture, style: { display: 'none' } });
    let settled = false;
    input.addEventListener('change', () => { settled = true; resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { if (!settled) resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function safeFilename(name, ext) {
  const base = String(name || 'parcours').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'parcours';
  return `${base}.${ext}`;
}

/* ---------- silhouette de tracé (vignettes) ---------- */
export function drawSilhouette(canvas, coords, color, { pad = 7, size = 58 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr; canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);
  if (!coords || coords.length < 2) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, latSum = 0;
  for (const c of coords) latSum += c[1];
  const k = Math.cos((latSum / coords.length) * Math.PI / 180);
  const pts = coords.map((c) => [c[0] * k, c[1]]);
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const dx = maxX - minX || 1e-9, dy = maxY - minY || 1e-9;
  const s = Math.min((size - 2 * pad) / dx, (size - 2 * pad) / dy);
  const ox = (size - dx * s) / 2, oy = (size - dy * s) / 2;
  const P = ([x, y]) => [ox + (x - minX) * s, size - (oy + (y - minY) * s)];
  ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  const [sx, sy] = P(pts[0]);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(sx, sy, 3.2, 0, Math.PI * 2); ctx.fill();
}

/* ---------- feuille coulissante ---------- */
export class Sheet {
  constructor({ peek = 150, half = 0.5, full = 0.94, initial = 'half', onSnap, className = '' } = {}) {
    this.cfg = { peek, half, full };
    this.snapName = initial;
    this.onSnap = onSnap;
    this.el = h('section', { class: ('sheet ' + className).trim() });
    this.grip = h('div', { class: 'sheet-grip', role: 'button', tabindex: '0', 'aria-label': 'Agrandir ou réduire le panneau' });
    this.head = h('div', { class: 'sheet-head' });
    this.body = h('div', { class: 'sheet-body' });
    this.el.append(this.grip, this.head, this.body);
    this.grip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.setSnap(this.snapName === 'full' ? 'half' : 'full'); }
    });
    this.grip.addEventListener('click', () => { if (!this._moved) this.setSnap(this.snapName === 'peek' ? 'half' : this.snapName === 'half' ? 'full' : 'peek'); });
    const startDrag = (e) => {
      if (e.button > 0) return;
      if (e.target.closest('input, textarea, select, button, a, [contenteditable]') && e.currentTarget !== this.grip) return;
      this._moved = false;
      const startY = e.clientY, startH = this.el.getBoundingClientRect().height, t0 = performance.now();
      let lastY = startY, lastT = t0, v = 0;
      const target = e.currentTarget;
      target.setPointerCapture?.(e.pointerId);
      this.el.classList.add('dragging');
      const move = (ev) => {
        const dy = ev.clientY - startY;
        if (Math.abs(dy) > 4) this._moved = true;
        const now = performance.now();
        v = (ev.clientY - lastY) / Math.max(1, now - lastT);
        lastY = ev.clientY; lastT = now;
        this.el.style.setProperty('--h', Math.max(70, Math.min(this.maxPx(), startH - dy)) + 'px');
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        this.el.classList.remove('dragging');
        if (!this._moved) { this.apply(); return; }
        const cur = this.el.getBoundingClientRect().height;
        const order = ['peek', 'half', 'full'];
        let best = order.reduce((a, b) => (Math.abs(this.px(b) - cur) < Math.abs(this.px(a) - cur) ? b : a));
        if (Math.abs(v) > 0.6) {
          const i = order.indexOf(this.nearestBelowOrAbove(cur, v < 0));
          best = order[Math.max(0, Math.min(2, i))];
        }
        this.setSnap(best);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    };
    this.grip.addEventListener('pointerdown', startDrag);
    this.head.addEventListener('pointerdown', startDrag);
    window.addEventListener('resize', () => this.apply());
  }
  nearestBelowOrAbove(cur, up) {
    const order = ['peek', 'half', 'full'];
    if (up) return order.find((n) => this.px(n) > cur + 10) || 'full';
    return [...order].reverse().find((n) => this.px(n) < cur - 10) || 'peek';
  }
  available() {
    const app = document.getElementById('app');
    const dock = document.getElementById('tabbar')?.offsetHeight || 64;
    return Math.max(200, app.clientHeight - dock);
  }
  maxPx() { return this.available() - 8; }
  px(name) {
    const v = this.cfg[name];
    const avail = this.available();
    const val = v <= 1 ? avail * v : v;
    return Math.round(Math.min(this.maxPx(), Math.max(90, val)));
  }
  setSnap(name) {
    this.snapName = name;
    this.apply();
    this.onSnap?.(name, this.px(name));
  }
  apply() { this.el.style.setProperty('--h', this.px(this.snapName) + 'px'); }
  get visibleHeight() { return this.el.isConnected && !this.el.closest('[hidden]') ? this.px(this.snapName) : 0; }
}
