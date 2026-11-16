// Lecture et écriture de fichiers GPX (1.0 et 1.1), y compris les routes Garmin (gpxx:rpt).
import { computeStats, previewOf, simplifyTo } from './geo.js';
import { uid } from './ui.js';

const round = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Fichier illisible : le XML est invalide.');
  const root = doc.documentElement;
  if (!root || root.localName !== 'gpx') throw new Error('Ce fichier n’est pas un GPX.');

  const kids = (el, name) => [...el.children].filter((c) => c.localName === name);
  const kid = (el, name) => kids(el, name)[0];
  const txt = (el, name) => (el && kid(el, name)?.textContent.trim()) || '';
  const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };
  const time = (s) => { if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
  const pt = (el) => {
    const lat = num(el.getAttribute('lat')), lon = num(el.getAttribute('lon'));
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [round(lon, 6), round(lat, 6), num(txt(el, 'ele')), time(txt(el, 'time'))];
  };

  const meta = kid(root, 'metadata');
  const out = {
    name: txt(meta, 'name') || txt(root, 'name'),
    desc: txt(meta, 'desc') || txt(root, 'desc'),
    time: time(txt(meta, 'time') || txt(root, 'time')),
    creator: root.getAttribute('creator') || '',
    tracks: [], routes: [], waypoints: [],
  };

  for (const trk of kids(root, 'trk')) {
    const segs = kids(trk, 'trkseg').map((s) => kids(s, 'trkpt').map(pt).filter(Boolean)).filter((s) => s.length);
    if (segs.length) out.tracks.push({ name: txt(trk, 'name'), segments: segs });
  }
  for (const rte of kids(root, 'rte')) {
    const points = [];
    const detail = [];
    for (const rp of kids(rte, 'rtept')) {
      const p = pt(rp);
      if (!p) continue;
      points.push({ lon: p[0], lat: p[1], name: txt(rp, 'name') });
      detail.push(p);
      const ext = kid(rp, 'extensions');
      if (ext) for (const rpt of ext.getElementsByTagNameNS('*', 'rpt')) { const q = pt(rpt); if (q) detail.push(q); }
    }
    if (points.length) out.routes.push({ name: txt(rte, 'name'), points, detail });
  }
  for (const w of kids(root, 'wpt')) {
    const p = pt(w);
    if (p) out.waypoints.push({ lon: p[0], lat: p[1], ele: p[2], name: txt(w, 'name'), desc: txt(w, 'desc') || txt(w, 'cmt') });
  }
  if (!out.tracks.length && !out.routes.length && !out.waypoints.length) throw new Error('Ce GPX ne contient ni trace, ni route, ni point.');
  return out;
}

/** Transforme un GPX analysé en parcours de la bibliothèque. */
export function gpxToItem(g, filename = '') {
  let segments = [];
  if (g.tracks.length) segments = g.tracks.flatMap((t) => t.segments);
  else if (g.routes.length) segments = g.routes.map((r) => r.detail).filter((s) => s.length > 1);
  let waypoints = null;
  if (g.routes.length) {
    const pts = g.routes[0].points;
    waypoints = (pts.length > 60 ? simplifyTo(pts.map((p) => [p.lon, p.lat, p.name]), 60).map((c) => ({ lon: c[0], lat: c[1], name: c[2] || '' })) : pts)
      .map((p) => ({ lon: p.lon, lat: p.lat, name: p.name || '' }));
  }
  const pois = g.waypoints.map((w) => ({ lon: w.lon, lat: w.lat, name: w.name, desc: w.desc }));
  if (!segments.length && pois.length >= 2 && !waypoints) {
    // GPX ne contenant que des points : on les traite comme des étapes à relier
    waypoints = pois.map((p) => ({ lon: p.lon, lat: p.lat, name: p.name }));
  }
  const fileBase = filename.replace(/\.(gpx|xml)$/i, '').replace(/[_-]+/g, ' ').trim();
  const name = g.name || g.tracks[0]?.name || g.routes[0]?.name || fileBase || 'Parcours importé';
  const stats = computeStats(segments);
  if (!stats.bbox && waypoints) stats.bbox = bboxFromPoints(waypoints);
  if (!stats.bbox && pois.length) stats.bbox = bboxFromPoints(pois);
  const id = uid();
  const meta = {
    id, kind: 'import', name, notes: g.desc || '',
    date: stats.start ? new Date(stats.start).toISOString() : g.time ? new Date(g.time).toISOString() : null,
    stats, preview: segments.length ? previewOf(segments) : (waypoints || []).map((w) => [w.lon, w.lat]),
    waypoints, source: { filename, creator: g.creator, type: g.tracks.length ? 'trace' : g.routes.length ? 'route' : 'points' },
  };
  return { meta, geom: { id, segments, pois } };
}

function bboxFromPoints(pts) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of pts) { w = Math.min(w, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
  return [w, s, e, n];
}

const xml = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const coordAttr = (lon, lat) => `lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"`;

/** Génère un GPX 1.1 : trace (trk), étapes (rte) et points d'intérêt (wpt). */
export function toGpx(meta, geom, { track = true, route = true, pois = true, photos = [] } = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Lacets" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    `  <metadata><name>${xml(meta.name)}</name>${meta.notes ? `<desc>${xml(meta.notes)}</desc>` : ''}<time>${new Date(meta.date || meta.createdAt || Date.now()).toISOString()}</time></metadata>`,
  ];
  if (pois) {
    for (const p of geom.pois || []) lines.push(`  <wpt ${coordAttr(p.lon, p.lat)}><name>${xml(p.name || 'Point')}</name>${p.desc ? `<desc>${xml(p.desc)}</desc>` : ''}</wpt>`);
    for (const ph of photos) if (ph.lon != null) lines.push(`  <wpt ${coordAttr(ph.lon, ph.lat)}>${ph.time ? `<time>${new Date(ph.time).toISOString()}</time>` : ''}<name>${xml(ph.caption || 'Photo')}</name><sym>Scenic Area</sym></wpt>`);
  }
  const wps = meta.waypoints || [];
  if (route && wps.length >= 2) {
    lines.push('  <rte>', `    <name>${xml(meta.name)}</name>`);
    wps.forEach((w, i) => {
      const nm = w.name || (i === 0 ? 'Départ' : i === wps.length - 1 ? 'Arrivée' : `Étape ${i}`);
      lines.push(`    <rtept ${coordAttr(w.lon, w.lat)}><name>${xml(nm)}</name></rtept>`);
    });
    lines.push('  </rte>');
  }
  if (track && geom.segments?.some((s) => s.length)) {
    lines.push('  <trk>', `    <name>${xml(meta.name)}</name>`, '    <type>motorcycling</type>');
    for (const seg of geom.segments) {
      if (!seg.length) continue;
      lines.push('    <trkseg>');
      for (const p of seg) {
        let s = `      <trkpt ${coordAttr(p[0], p[1])}>`;
        if (p[2] != null && Number.isFinite(p[2])) s += `<ele>${p[2].toFixed(1)}</ele>`;
        if (p[3]) s += `<time>${new Date(p[3]).toISOString()}</time>`;
        lines.push(s + '</trkpt>');
      }
      lines.push('    </trkseg>');
    }
    lines.push('  </trk>');
  }
  lines.push('</gpx>');
  return lines.join('\n');
}

export async function readGpxFile(file) {
  const text = await file.text();
  return gpxToItem(parseGpx(text), file.name);
}
