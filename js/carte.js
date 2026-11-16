// Écran Carte : vue d'ensemble de tous les parcours, accès rapide à l'import GPX.
import { app, on, emit } from './state.js';
import { h, icon, plural } from './ui.js';
import { setData, clearData, fc, lineFeature } from './mapview.js';
import { getItems, pickAndImport, openItem } from './library.js';

let welcome, dock, legend, visible = false;

function draw() {
  const items = getItems();
  if (visible) setData('ov-items', fc(items.filter((m) => m.preview?.length > 1).map((m) => lineFeature(m.preview, { id: m.id, kind: m.kind }))));
  welcome.hidden = !visible || items.length > 0;
  dock.hidden = !visible || !items.length;
  const count = (k) => items.filter((m) => m.kind === k).length;
  legend.replaceChildren(...[['plan', 'planifié', 'planifiés'], ['ride', 'balade', 'balades'], ['import', 'importé', 'importés']]
    .filter(([k]) => count(k))
    .map(([k, one, many]) => h('span', { class: `kind-tag k-${k}` }, plural(count(k), one, many))));
  emit('insets-changed');
}

export const carte = {
  id: 'carte',
  mount(root) {
    const imp = h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, icon('upload'), 'Importer un GPX');
    const plan = h('button', { class: 'btn btn-lg', type: 'button' }, icon('plan'), 'Planifier un parcours');
    imp.onclick = pickAndImport;
    plan.onclick = () => emit('show-screen', 'planifier');
    welcome = h('section', { class: 'welcome', hidden: true },
      h('h2', {}, 'Prêt à rouler ?'),
      h('p', {}, 'Ouvre un fichier GPX pour voir le tracé, son profil et ses statistiques, ou dessine ton propre itinéraire moto. Tes parcours et tes photos restent sur ce téléphone.'),
      h('div', { class: 'btn-row' }, imp, plan));
    const imp2 = h('button', { class: 'btn btn-primary', type: 'button', style: { boxShadow: 'var(--shadow)' } }, icon('upload'), 'Importer un GPX');
    imp2.onclick = pickAndImport;
    legend = h('div', { class: 'overlay-legend', style: { position: 'static' } });
    dock = h('div', { style: { position: 'absolute', left: '12px', bottom: 'calc(var(--dock) + 12px)', zIndex: 12, display: 'grid', gap: '8px', justifyItems: 'start' } }, legend, imp2);
    root.append(welcome, dock);
    on('items-loaded', draw);
  },
  show() { visible = true; draw(); },
  hide() { visible = false; clearData('ov-items'); welcome.hidden = true; dock.hidden = true; },
  onMapClick(e) {
    const box = [[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 12]];
    const f = app.map.queryRenderedFeatures(box, { layers: ['ov-items-line'] })[0];
    if (f) openItem(f.properties.id);
  },
  bottomInset() { return welcome && !welcome.hidden ? welcome.offsetHeight + 12 : 0; },
};
