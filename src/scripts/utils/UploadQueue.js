// File d'attente des vêtements ajoutés: ils sont gardés sur l'appareil (IndexedDB)
// et envoyés dans Supabase dès qu'il y a Internet et une session.
// En attendant, leurs images sont déjà dans le cache: ils s'affichent partout sur l'appareil.

import { STORAGE_URL, IMAGE_CACHE, readPendingRows, writePendingRows, forgetRow } from './Catalog.js';
import { supabase, currentSession } from './Supabase.js';

const DB_NAME = 'fitgen';
const STORE = 'uploads';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request && request.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

const fileUrl = (row, suffix) => `${STORAGE_URL}/${row.category}/${row.id}${suffix}.webp`;

// Ajoute un vêtement: cache d'images + file d'attente + liste en attente, puis tente l'envoi
export async function enqueue(row, files) {
  if ('caches' in window) {
    const cache = await caches.open(IMAGE_CACHE);
    const response = (blob) => new Response(blob, { headers: { 'Content-Type': 'image/webp' } });
    await cache.put(fileUrl(row, ''), response(files.full));
    await cache.put(fileUrl(row, '-sm'), response(files.small));
  }

  await run('readwrite', (store) => store.put({ ...row, files }));
  writePendingRows([...readPendingRows().filter((pending) => pending.id !== row.id), row]);
  return flush();
}

// Supprime un vêtement pour de bon: fichiers et ligne dans Supabase, puis copie sur l'appareil.
// Un vêtement encore en attente d'envoi est seulement retiré de la file.
export async function remove(row) {
  const queued = await run('readonly', (store) => store.get(row.id));

  if (!queued) {
    // La ligne d'abord: si les droits manquent, rien n'est touché
    const { data, error } = await supabase().from('clothes').delete().eq('id', row.id).select('id');
    if (error) throw error;
    if (!data.length) throw new Error('Not allowed to delete this piece');

    const files = ['', '-sm', '-master', '-thumb'].map((suffix) => `${row.category}/${row.id}${suffix}.webp`);
    const { error: storageError } = await supabase().storage.from('clothes').remove(files);
    if (storageError) console.warn('Fichiers du vêtement', storageError);
  } else {
    await run('readwrite', (store) => store.delete(row.id));
  }

  await forgetRow(row);
}

// Remplace un vêtement par sa nouvelle version: même rang dans la liste, puis l'ancienne est supprimée.
// Demande Internet: l'ancienne version n'est supprimée qu'une fois la nouvelle bien envoyée.
export async function replace(old, row, files) {
  if (!navigator.onLine) throw new Error('Offline');

  const { data, error } = await supabase().from('clothes').select('position').eq('id', old.id).maybeSingle();
  if (error) throw error;
  if (data) row.position = data.position;

  const left = await enqueue(row, files);
  if (left) throw new Error('Upload failed');
  await remove(old);
}

let flushing = null;

// Envoie tout ce qui attend. Retourne le nombre de vêtements encore en attente.
export function flush() {
  if (!flushing) {
    flushing = sendAll().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function sendAll() {
  const items = await run('readonly', (store) => store.getAll());
  if (!items.length || !navigator.onLine) return items.length;
  if (!(await currentSession())) return items.length;

  const bucket = supabase().storage.from('clothes');
  let left = items.length;

  for (const item of items) {
    const { files, ...row } = item;
    try {
      const options = { contentType: 'image/webp', cacheControl: '31536000', upsert: true };
      for (const [suffix, blob] of [['', files.full], ['-sm', files.small], ['-master', files.master]]) {
        const { error } = await bucket.upload(`${row.category}/${row.id}${suffix}.webp`, blob, options);
        if (error) throw error;
      }

      const { error } = await supabase().from('clothes').upsert(row);
      if (error) throw error;

      await run('readwrite', (store) => store.delete(row.id));
      writePendingRows(readPendingRows().filter((pending) => pending.id !== row.id));
      left--;
    } catch (error) {
      // Réseau coupé ou droits manquants: on réessaiera plus tard
      console.warn('Envoi du vêtement', row.id, error);
      break;
    }
  }
  return left;
}
