// Profil altimétrique interactif (canvas) : glisser le doigt pour lire la pente et situer le point sur la carte.
import { h, fmtInt } from './ui.js';

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function niceStep(range, target) {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

export class Profile {
  constructor(container, { colorVar = '--route', onHover } = {}) {
    this.el = container;
    container.classList.add('profile');
    container.setAttribute('role', 'img');
    this.canvas = h('canvas');
    this.tip = h('div', { class: 'profile-tip', hidden: true });
    this.empty = h('div', { class: 'profile-empty', hidden: true });
    container.append(this.canvas, this.tip, this.empty);
    this.colorVar = colorVar;
    this.onHover = onHover;
    this.pts = [];
    this.hoverIndex = null;
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(container);
    const move = (e) => this.hover(e.clientX);
    container.addEventListener('pointerdown', (e) => { container.setPointerCapture?.(e.pointerId); move(e); });
    container.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) move(e); });
    const end = () => this.hover(null);
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
    container.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') end(); });
  }

  set(pts, { message = 'Pas de données d’altitude', colorVar } = {}) {
    if (colorVar) this.colorVar = colorVar;
    this.pts = pts || [];
    this.message = message;
    this.hoverIndex = null;
    this.tip.hidden = true;
    const total = this.pts.length ? this.pts[this.pts.length - 1].d : 0;
    const es = this.pts.map((p) => p.e);
    this.el.setAttribute('aria-label', this.pts.length > 1
      ? `Profil altimétrique sur ${nf1.format(total / 1000)} km, de ${fmtInt(Math.min(...es))} à ${fmtInt(Math.max(...es))} m`
      : this.message);
    this.draw();
  }

  frame() {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    return { W, H, l: this.left || 42, r: 10, t: 16, b: 24 };
  }

  measureLeft() {
    // largeur de la plus longue étiquette d'altitude, pour qu'aucune ne soit coupée
    this.left = 42;
    const s = this.scales();
    const ctx = this.canvas.getContext('2d');
    ctx.font = '500 12px Barlow, system-ui, sans-serif';
    let w = 0;
    for (let v = s.y0; v <= s.y1 + 1e-6; v += s.ystep) w = Math.max(w, ctx.measureText(`${fmtInt(v)} m`).width);
    this.left = Math.max(34, Math.ceil(w) + 12);
  }

  scales() {
    const f = this.frame();
    const pts = this.pts;
    const total = pts[pts.length - 1].d || 1;
    let min = Infinity, max = -Infinity;
    for (const p of pts) { if (p.e < min) min = p.e; if (p.e > max) max = p.e; }
    if (max - min < 60) { const mid = (max + min) / 2; min = mid - 30; max = mid + 30; }
    const ystep = niceStep(max - min, 3);
    const y0 = Math.floor(min / ystep) * ystep, y1 = Math.ceil(max / ystep) * ystep;
    const pw = f.W - f.l - f.r, ph = f.H - f.t - f.b;
    return {
      f, total, y0, y1, ystep,
      x: (d) => f.l + (d / total) * pw,
      y: (e) => f.t + ph - ((e - y0) / (y1 - y0 || 1)) * ph,
    };
  }

  draw() {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = W * dpr; this.canvas.height = H * dpr;
    const ctx = this.canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const ok = this.pts.length > 1;
    this.empty.hidden = ok;
    this.empty.textContent = ok ? '' : this.message;
    if (!ok) return;

    this.measureLeft();
    const s = this.scales();
    const color = css(this.colorVar) || '#c8007a';
    const muted = css('--ink-3');
    const rule = css('--rule');
    const ink = css('--ink');
    const panel = css('--panel');
    ctx.font = '500 12px Barlow, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // grille horizontale + altitudes
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.textAlign = 'right';
    for (let v = s.y0; v <= s.y1 + 1e-6; v += s.ystep) {
      const y = Math.round(s.y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(s.f.l, y); ctx.lineTo(W - s.f.r, y); ctx.stroke();
      ctx.fillText(`${fmtInt(v)} m`, s.f.l - 6, y);
    }
    // distances
    const totalKm = s.total / 1000;
    const xstep = niceStep(totalKm, Math.max(2, Math.floor((W - 60) / 70)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let k = 0; k <= totalKm + 1e-6; k += xstep) {
      const x = s.x(k * 1000);
      if (x > W - 14) break;
      ctx.fillText(k === 0 ? '0' : `${nf1.format(k)} km`, Math.max(s.f.l + 8, x), H - s.f.b + 6);
    }

    // aire + ligne
    const pts = this.pts;
    const base = s.y(s.y0);
    ctx.beginPath();
    ctx.moveTo(s.x(pts[0].d), base);
    for (const p of pts) ctx.lineTo(s.x(p.d), s.y(p.e));
    ctx.lineTo(s.x(pts[pts.length - 1].d), base);
    ctx.closePath();
    ctx.globalAlpha = 0.16; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(s.x(p.d), s.y(p.e)) : ctx.moveTo(s.x(p.d), s.y(p.e))));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    // point culminant (étiquette directe)
    let top = pts[0];
    for (const p of pts) if (p.e > top.e) top = p;
    const tx = s.x(top.d), ty = s.y(top.e);
    ctx.fillStyle = panel; ctx.beginPath(); ctx.arc(tx, ty, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 12px Barlow, system-ui, sans-serif'; ctx.fillStyle = ink; ctx.textBaseline = 'bottom';
    ctx.textAlign = tx < 70 ? 'left' : tx > W - 70 ? 'right' : 'center';
    ctx.fillText(`${fmtInt(top.e)} m`, tx, Math.max(12, ty - 5));

    // curseur
    if (this.hoverIndex != null) {
      const p = pts[this.hoverIndex];
      const x = s.x(p.d), y = s.y(p.e);
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, s.f.t - 6); ctx.lineTo(Math.round(x) + 0.5, base); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = panel; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  hover(clientX) {
    if (clientX == null || this.pts.length < 2) {
      this.hoverIndex = null;
      this.tip.hidden = true;
      this.draw();
      this.onHover?.(null);
      return;
    }
    const s = this.scales();
    const rect = this.el.getBoundingClientRect();
    const d = Math.max(0, Math.min(s.total, ((clientX - rect.left - s.f.l) / (s.f.W - s.f.l - s.f.r)) * s.total));
    let lo = 0, hi = this.pts.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.pts[mid].d < d) lo = mid + 1; else hi = mid; }
    if (lo > 0 && Math.abs(this.pts[lo - 1].d - d) < Math.abs(this.pts[lo].d - d)) lo--;
    this.hoverIndex = lo;
    const p = this.pts[lo];
    // pente moyenne sur ±150 m
    let a = lo, b = lo;
    while (a > 0 && p.d - this.pts[a].d < 150) a--;
    while (b < this.pts.length - 1 && this.pts[b].d - p.d < 150) b++;
    const run = this.pts[b].d - this.pts[a].d;
    const grade = run > 30 ? ((this.pts[b].e - this.pts[a].e) / run) * 100 : 0;
    this.tip.textContent = `${nf1.format(p.d / 1000)} km · ${fmtInt(p.e)} m · ${grade >= 0 ? '+' : '−'}${nf1.format(Math.abs(grade))} %`;
    this.tip.hidden = false;
    const x = s.x(p.d);
    const w = this.tip.offsetWidth || 150;
    this.tip.style.left = `${Math.max(w / 2 + 4, Math.min(s.f.W - w / 2 - 4, x))}px`;
    this.draw();
    this.onHover?.(p);
  }
}
