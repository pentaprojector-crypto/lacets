// Géométrie : distances, polylignes, simplification, projection sur un tracé, statistiques.
// Les points sont des tableaux [lon, lat, altitude|null, temps_ms|null].

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function dist(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function cumulative(coords) {
  const c = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) c[i] = c[i - 1] + dist(coords[i - 1], coords[i]);
  return c;
}

export function bearing(a, b) {
  const p1 = rad(a[1]), p2 = rad(b[1]), dl = rad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function angleDiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}

export function decodePolyline(str, precision = 6) {
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  const factor = 10 ** precision;
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

/** Douglas-Peucker en mètres (projection locale). */
export function simplify(coords, tolerance) {
  const n = coords.length;
  if (n <= 2) return coords.slice();
  const lat0 = rad(coords[0][1]);
  const kx = (R * Math.cos(lat0) * Math.PI) / 180, ky = (R * Math.PI) / 180;
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = coords[i][0] * kx; Y[i] = coords[i][1] * ky; }
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const dx = X[b] - X[a], dy = Y[b] - Y[a];
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      let t = len2 ? ((X[i] - X[a]) * dx + (Y[i] - Y[a]) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = X[a] + t * dx - X[i], ey = Y[a] + t * dy - Y[i];
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > tol2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(coords[i]);
  return out;
}

export function simplifyTo(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords.slice();
  let tol = 4, out = simplify(coords, tol);
  while (out.length > maxPoints && tol < 20000) { tol *= 1.7; out = simplify(coords, tol); }
  return out;
}

export function indexAtDistance(cum, d) {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < d) lo = mid + 1; else hi = mid; }
  return Math.max(0, lo - 1);
}

export function pointAt(coords, cum, d) {
  const total = cum[cum.length - 1];
  if (d <= 0) return coords[0];
  if (d >= total) return coords[coords.length - 1];
  const i = indexAtDistance(cum, d);
  const seg = cum[i + 1] - cum[i];
  const t = seg ? (d - cum[i]) / seg : 0;
  const a = coords[i], b = coords[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Échantillonne n points régulièrement espacés le long du tracé. */
export function sampleAlong(coords, cum, n) {
  const total = cum[cum.length - 1];
  const out = [];
  for (let k = 0; k < n; k++) {
    const d = n === 1 ? 0 : (total * k) / (n - 1);
    const p = pointAt(coords, cum, d);
    out.push([p[0], p[1], d]);
  }
  return out;
}

/** Projette un point sur une portion du tracé. Renvoie la distance au tracé et l'abscisse curviligne. */
export function projectOnLine(p, coords, cum, from = 0, to = coords.length - 1) {
  const kx = Math.cos(rad(p[1])) * 111320, ky = 110574;
  let bestD2 = Infinity, bestI = -1, bestT = 0;
  from = Math.max(0, from);
  to = Math.min(coords.length - 1, to);
  for (let i = from; i < to; i++) {
    const a = coords[i], b = coords[i + 1];
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = ax + t * dx, y = ay + t * dy;
    const d2 = x * x + y * y;
    if (d2 < bestD2) { bestD2 = d2; bestI = i; bestT = t; }
  }
  if (bestI < 0) return null;
  const along = cum[bestI] + bestT * (cum[bestI + 1] - cum[bestI]);
  const a = coords[bestI], b = coords[bestI + 1];
  return { dist: Math.sqrt(bestD2), along, i: bestI, t: bestT, point: [a[0] + (b[0] - a[0]) * bestT, a[1] + (b[1] - a[1]) * bestT] };
}

export function bboxOf(lines) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const line of lines) for (const c of line) {
    if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export function circle(center, radius, steps = 48) {
  const [lon, lat] = center;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dx = radius * Math.cos(a), dy = radius * Math.sin(a);
    ring.push([lon + dx / (111320 * Math.cos(rad(lat))), lat + dy / 110574]);
  }
  return ring;
}

/** Statistiques d'un ensemble de segments [[lon,lat,ele,t],...]. */
export function computeStats(segments, { eleThreshold = 4 } = {}) {
  let distance = 0, moving = 0, gain = 0, loss = 0, maxSpeed = 0;
  let minEle = Infinity, maxEle = -Infinity, tStart = null, tEnd = null, points = 0;
  let hasEle = false, hasTime = false;
  for (const seg of segments) {
    if (!seg?.length) continue;
    const cum = cumulative(seg);
    let anchor = null;
    let j = 0;
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      points++;
      if (i > 0) {
        const d = cum[i] - cum[i - 1];
        distance += d;
        const t0 = seg[i - 1][3], t1 = p[3];
        if (t0 && t1) {
          const dt = (t1 - t0) / 1000;
          if (dt > 0 && dt < 600 && d / dt > 0.9) moving += dt;
        }
      }
      const e = p[2];
      if (e != null && Number.isFinite(e)) {
        hasEle = true;
        if (e < minEle) minEle = e;
        if (e > maxEle) maxEle = e;
        if (anchor == null) anchor = e;
        else if (e - anchor >= eleThreshold) { gain += e - anchor; anchor = e; }
        else if (anchor - e >= eleThreshold) { loss += anchor - e; anchor = e; }
      }
      if (p[3]) {
        hasTime = true;
        if (tStart == null || p[3] < tStart) tStart = p[3];
        if (tEnd == null || p[3] > tEnd) tEnd = p[3];
        // vitesse max lissée sur une fenêtre d'au moins 8 s
        while (j < i && seg[j + 1]?.[3] && p[3] - seg[j + 1][3] >= 8000) j++;
        if (seg[j][3]) {
          const dt = (p[3] - seg[j][3]) / 1000;
          if (dt >= 8 && dt <= 40) {
            const v = ((cum[i] - cum[j]) / dt) * 3.6;
            if (v > maxSpeed && v < 330) maxSpeed = v;
          }
        }
      }
    }
  }
  const all = segments.filter((s) => s?.length);
  return {
    distance,
    duration: hasTime && tEnd > tStart ? (tEnd - tStart) / 1000 : null,
    moving: hasTime ? moving : null,
    avgSpeed: hasTime && moving > 30 ? (distance / moving) * 3.6 : null,
    maxSpeed: hasTime && maxSpeed > 0 ? maxSpeed : null,
    gain: hasEle ? gain : null,
    loss: hasEle ? loss : null,
    minEle: hasEle ? minEle : null,
    maxEle: hasEle ? maxEle : null,
    hasEle, hasTime, points,
    start: tStart, end: tEnd,
    bbox: bboxOf(all),
  };
}

/** Profil altimétrique : [{d, e}] le long des segments mis bout à bout. */
export function profileOf(segments, maxPoints = 700) {
  const pts = [];
  let offset = 0;
  for (const seg of segments) {
    if (!seg?.length) continue;
    const cum = cumulative(seg);
    for (let i = 0; i < seg.length; i++) {
      const e = seg[i][2];
      if (e != null && Number.isFinite(e)) pts.push({ d: offset + cum[i], e, lon: seg[i][0], lat: seg[i][1] });
    }
    offset += cum[cum.length - 1];
  }
  if (pts.length <= maxPoints) return pts;
  const step = pts.length / maxPoints;
  const out = [];
  for (let k = 0; k < maxPoints; k++) {
    // garde l'extrême local de chaque paquet pour ne pas raboter les cols
    const a = Math.floor(k * step), b = Math.min(pts.length, Math.floor((k + 1) * step));
    let best = pts[a];
    for (let i = a; i < b; i++) if (Math.abs(pts[i].e - pts[a].e) > Math.abs(best.e - pts[a].e)) best = pts[i];
    out.push(best);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Aperçu simplifié pour la vue d'ensemble et les vignettes. */
export function previewOf(segments, maxPoints = 160) {
  const flat = [];
  for (const seg of segments) for (const p of seg) flat.push([p[0], p[1]]);
  return simplifyTo(flat, maxPoints).map((c) => [+c[0].toFixed(5), +c[1].toFixed(5)]);
}

export function flatten(segments) {
  const out = [];
  for (const seg of segments) for (const p of seg) out.push(p);
  return out;
}
