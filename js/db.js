// Stockage local (IndexedDB) : parcours (métadonnées + géométrie séparée), photos, réglages.
import { emit } from './state.js';

const DB_NAME = 'lacets';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Stockage local indisponible sur ce navigateur')); return; }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('geoms')) db.createObjectStore('geoms', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('itemId', 'itemId');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet'));
  });
  return dbp;
}

const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const txDone = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transaction annulée')); });

export async function get(store, key) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).get(key));
}
export async function all(store) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).getAll());
}
export async function put(store, value, key) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  if (key === undefined) t.objectStore(store).put(value); else t.objectStore(store).put(value, key);
  await txDone(t);
}
export async function del(store, key) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).delete(key);
  await txDone(t);
}

export const kv = {
  get: (k) => get('kv', k).catch(() => undefined),
  set: (k, v) => put('kv', v, k),
  del: (k) => del('kv', k),
};

/* ---------- parcours ---------- */
export const listItems = () => all('items');
export const getItem = (id) => get('items', id);
export const getGeom = (id) => get('geoms', id);

let persistAsked = false;
export async function saveItem(meta, geom) {
  meta.updatedAt = new Date().toISOString();
  if (!meta.createdAt) meta.createdAt = meta.updatedAt;
  const db = await open();
  const t = db.transaction(['items', 'geoms'], 'readwrite');
  t.objectStore('items').put(meta);
  if (geom) t.objectStore('geoms').put({ ...geom, id: meta.id });
  await txDone(t);
  emit('items-changed', { id: meta.id });
  if (!persistAsked && navigator.storage?.persist) {
    persistAsked = true;
    navigator.storage.persist().catch(() => {});
  }
  return meta;
}

export async function deleteItem(id) {
  const db = await open();
  const photos = await listPhotos(id);
  const t = db.transaction(['items', 'geoms', 'photos'], 'readwrite');
  t.objectStore('items').delete(id);
  t.objectStore('geoms').delete(id);
  for (const p of photos) t.objectStore('photos').delete(p.id);
  await txDone(t);
  emit('items-changed', { id, deleted: true });
}

/* ---------- photos ---------- */
export async function listPhotos(itemId) {
  const db = await open();
  const list = await reqP(db.transaction('photos').objectStore('photos').index('itemId').getAll(itemId));
  return list.sort((a, b) => (a.time || 0) - (b.time || 0));
}
export async function savePhoto(photo) {
  await put('photos', photo);
  emit('photos-changed', { itemId: photo.itemId });
}
export async function deletePhoto(photo) {
  await del('photos', photo.id);
  emit('photos-changed', { itemId: photo.itemId });
}
export const allPhotos = () => all('photos');

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
