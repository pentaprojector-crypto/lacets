// Carte MapLibre : fonds de carte, couches de tracés, marqueurs, position de l'utilisateur.
import { app, emit } from './state.js';
import { circle } from './geo.js';

const IGN = (layer, fmt, set) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=${set}&FORMAT=${fmt}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

export const BASEMAPS = {
  routier: {
    label: 'Routier', hint: 'Monde · OpenFreeMap',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    swatch: 'linear-gradient(135deg,#f2efe9 0 45%,#f9c74f 45% 52%,#f2efe9 52% 70%,#a7cbe8 70%)',
  },
  nuit: {
    label: 'Nuit', hint: 'Monde · sombre',
    style: 'https://tiles.openfreemap.org/styles/dark',
    swatch: 'linear-gradient(135deg,#1b1f24 0 45%,#4a5260 45% 52%,#1b1f24 52% 70%,#2d3440 70%)',
  },
  ign: {
    label: 'Plan IGN', hint: 'France · routes numérotées',
    raster: { tiles: [IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png', 'PM')], maxzoom: 19, attribution: '© <a href="https://www.ign.fr/">IGN</a> Plan IGN' },
    swatch: 'linear-gradient(135deg,#fbfaf6 0 40%,#f39c50 40% 47%,#fbfaf6 47% 66%,#ffe36a 66% 72%,#d8ecc8 72%)',
  },
  topo: {
    label: 'Relief', hint: 'Monde · OpenTopoMap',
    raster: {
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), maxzoom: 17,
      attribution: 'Carte © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · données © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
    swatch: 'repeating-radial-gradient(circle at 30% 70%,#e8e2c8 0 6px,#c9c19a 6px 7px)',
  },
  sat: {
    label: 'Satellite', hint: 'France · photos IGN',
    raster: { tiles: [IGN('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg', 'PM_0_19')], maxzoom: 19, attribution: '© <a href="https://www.ign.fr/">IGN</a> Orthophotos' },
    swatch: 'linear-gradient(135deg,#3d4a2c,#6b7a45 40%,#8c8a6a 60%,#4b5a3a)',
  },
};

function styleFor(key) {
  const b = BASEMAPS[key] || BASEMAPS.routier;
  if (b.style) return b.style;
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: b.raster.tiles, tileSize: 256, maxzoom: b.raster.maxzoom, attribution: b.raster.attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

const EMPTY = { type: 'FeatureCollection', features: [] };
const sources = new Map();
const layers = [];
let styleReady = false;
let currentBase = 'routier';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export function colors() {
  return { plan: css('--route'), ride: css('--ride'), import: css('--import'), brake: css('--brake'), ink: css('--ink-3') };
}

function kindColor(c) {
  return ['match', ['get', 'kind'], 'plan', c.plan, 'ride', c.ride, 'import', c.import, 'community', c.plan, c.ink];
}

function defineOverlays() {
  const c = colors();
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  for (const id of ['ov-items', 'ov-sel', 'ov-comm', 'ov-plan', 'ov-follow', 'ov-join', 'ov-live', 'ov-acc']) sources.set(id, EMPTY);
  layers.push(
    { id: 'ov-items-casing', type: 'line', source: 'ov-items', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.55 } },
    { id: 'ov-items-line', type: 'line', source: 'ov-items', layout: round, paint: { 'line-color': kindColor(c), 'line-width': 3.5, 'line-opacity': 0.85 } },
    { id: 'ov-sel-casing', type: 'line', source: 'ov-sel', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 10 } },
    { id: 'ov-sel-line', type: 'line', source: 'ov-sel', layout: round, paint: { 'line-color': kindColor(c), 'line-width': 5.5 } },
    { id: 'ov-comm-casing', type: 'line', source: 'ov-comm', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 9 } },
    { id: 'ov-comm-line', type: 'line', source: 'ov-comm', layout: round, paint: { 'line-color': c.plan, 'line-width': 5, 'line-dasharray': [2, 1.2] } },
    { id: 'ov-plan-casing', type: 'line', source: 'ov-plan', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 10 }, filter: ['!=', ['get', 'pending'], true] },
    { id: 'ov-plan-line', type: 'line', source: 'ov-plan', layout: round, paint: { 'line-color': c.plan, 'line-width': 5.5 }, filter: ['!=', ['get', 'pending'], true] },
    { id: 'ov-plan-pending', type: 'line', source: 'ov-plan', layout: round, paint: { 'line-color': c.plan, 'line-width': 3, 'line-dasharray': [1, 2], 'line-opacity': 0.8 }, filter: ['==', ['get', 'pending'], true] },
    { id: 'ov-plan-hit', type: 'line', source: 'ov-plan', layout: round, paint: { 'line-color': '#000000', 'line-width': 28, 'line-opacity': 0.001 } },
    { id: 'ov-follow-casing', type: 'line', source: 'ov-follow', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 12 } },
    { id: 'ov-follow-line', type: 'line', source: 'ov-follow', layout: round, paint: { 'line-color': ['match', ['get', 'part'], 'done', '#8f98a3', c.plan], 'line-width': 7 } },
    { id: 'ov-join-line', type: 'line', source: 'ov-join', layout: round, paint: { 'line-color': c.plan, 'line-width': 5, 'line-dasharray': [1.2, 1] } },
    { id: 'ov-live-casing', type: 'line', source: 'ov-live', layout: round, paint: { 'line-color': '#ffffff', 'line-width': 8 } },
    { id: 'ov-live-line', type: 'line', source: 'ov-live', layout: round, paint: { 'line-color': c.brake, 'line-width': 4.5 } },
    { id: 'ov-acc-fill', type: 'fill', source: 'ov-acc', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 } },
    { id: 'ov-acc-line', type: 'line', source: 'ov-acc', paint: { 'line-color': '#1a73e8', 'line-width': 1, 'line-opacity': 0.5 } },
  );
}

function ensureOverlays() {
  const map = app.map;
  if (!map || !styleReady) return;
  for (const [id, data] of sources) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data, tolerance: 0.25 });
  for (const l of layers) if (!map.getLayer(l.id)) map.addLayer(l);
}

export function setData(id, data) {
  sources.set(id, data || EMPTY);
  const src = app.map?.getSource(id);
  if (src) src.setData(data || EMPTY);
}
export const clearData = (id) => setData(id, EMPTY);

export function refreshColors() {
  const map = app.map;
  if (!map || !styleReady) return;
  const c = colors();
  const set = (layer, prop, value) => { if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value); };
  set('ov-items-line', 'line-color', kindColor(c));
  set('ov-sel-line', 'line-color', kindColor(c));
  set('ov-comm-line', 'line-color', c.plan);
  set('ov-plan-line', 'line-color', c.plan);
  set('ov-plan-pending', 'line-color', c.plan);
  set('ov-follow-line', 'line-color', ['match', ['get', 'part'], 'done', '#8f98a3', c.plan]);
  set('ov-join-line', 'line-color', c.plan);
  set('ov-live-line', 'line-color', c.brake);
}

export function initMap(container, { center, zoom, basemap, transformRequest }) {
  defineOverlays();
  currentBase = BASEMAPS[basemap] ? basemap : 'routier';
  const map = new maplibregl.Map({
    container,
    style: styleFor(currentBase),
    center, zoom,
    attributionControl: false,
    pitchWithRotate: false,
    maxPitch: 60,
    fadeDuration: 120,
    transformRequest,
  });
  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution: 'Itinéraires <a href="https://valhalla.openstreetmap.de/">Valhalla · FOSSGIS</a>',
  }), 'bottom-right');
  map.on('style.load', () => { styleReady = true; ensureOverlays(); refreshColors(); emit('style-loaded'); });
  map.on('error', (e) => { if (e?.error?.status !== 404) console.debug('Carte :', e?.error?.message || e); });
  app.map = map;
  return map;
}

export function setBasemap(key) {
  if (!BASEMAPS[key] || !app.map) return;
  currentBase = key;
  styleReady = false;
  app.map.setStyle(styleFor(key), { diff: false });
}
export const basemap = () => currentBase;

/* ---------- marqueurs ---------- */
export function addMarker(el, lngLat, opts = {}) {
  return new maplibregl.Marker({ element: el, anchor: opts.anchor || 'center', draggable: !!opts.draggable, rotationAlignment: opts.rotationAlignment || 'viewport' })
    .setLngLat(lngLat).addTo(app.map);
}

/* ---------- cadrage ---------- */
export function fitBounds(bbox, { maxZoom = 15, duration = 700 } = {}) {
  const map = app.map;
  if (!map || !bbox) return;
  const { top, bottom, left = 0 } = app.insets ? app.insets() : { top: 80, bottom: 80 };
  const H = map.getContainer().clientHeight, W = map.getContainer().clientWidth;
  const avail = H - top - bottom;
  const pad = { top: top + 20, bottom: bottom + 24, left: left + 32, right: W < 700 ? 78 : 90 };
  if (avail < 140) { pad.top = 30; pad.bottom = Math.max(30, H - 200); }
  const [w, s, e, n] = bbox;
  if (Math.abs(e - w) < 1e-6 && Math.abs(n - s) < 1e-6) { flyTo([w, s], Math.min(maxZoom, 14)); return; }
  try { map.fitBounds([[w, s], [e, n]], { padding: pad, maxZoom, duration }); } catch { map.jumpTo({ center: [(w + e) / 2, (s + n) / 2] }); }
}

export function flyTo(lngLat, zoom, { duration = 800 } = {}) {
  const map = app.map;
  if (!map) return;
  const { top, bottom, left = 0 } = app.insets ? app.insets() : { top: 0, bottom: 0 };
  map.flyTo({ center: lngLat, zoom: zoom ?? Math.max(map.getZoom(), 13), offset: [left / 2, (top - bottom) / 2], duration });
}

/* ---------- ma position ---------- */
let meMarker = null;
export function showMe(pos, { follow = false } = {}) {
  if (!app.map || !pos) return;
  if (!meMarker) {
    const el = document.createElement('div');
    el.className = 'mk-me';
    meMarker = addMarker(el, [pos.lon, pos.lat]);
  }
  meMarker.setLngLat([pos.lon, pos.lat]);
  const el = meMarker.getElement();
  const hasHeading = pos.heading != null && (pos.speed ?? 0) > 1;
  el.classList.toggle('heading', hasHeading);
  if (hasHeading) el.style.setProperty('--hd', `${pos.heading - app.map.getBearing()}deg`);
  setData('ov-acc', pos.acc && pos.acc < 2000
    ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [circle([pos.lon, pos.lat], pos.acc)] }, properties: {} }
    : null);
  if (follow) flyTo([pos.lon, pos.lat], Math.max(app.map.getZoom(), 14));
}
export function hideMe() {
  meMarker?.remove();
  meMarker = null;
  clearData('ov-acc');
}

/* ---------- conversions GeoJSON ---------- */
export const lineFeature = (coords, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords.map((c) => [c[0], c[1]]) } });
export const multiLine = (segments, props = {}) => ({
  type: 'Feature', properties: props,
  geometry: { type: 'MultiLineString', coordinates: segments.filter((s) => s.length > 1).map((s) => s.map((c) => [c[0], c[1]])) },
});
export const fc = (features) => ({ type: 'FeatureCollection', features: features.filter(Boolean) });
