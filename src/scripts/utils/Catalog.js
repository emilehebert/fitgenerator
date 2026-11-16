// Projet Supabase. La clé "publishable" est faite pour être publique:
// la sécurité vient des règles RLS (voir supabase/setup.sql).
export const SUPABASE_URL = 'https://csxjgbfrbbmspxdjrkxc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_zMD2q8zaSKm4fKQkg_gzvA_iu06HsiO';

export const STORAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/clothes`;
const LOCAL_PATH = 'assets/images/clothes';
// Dernière liste reçue du cloud, gardée sur l'appareil
const CATALOG_KEY = 'fitgen-catalog';
// Même nom que dans sw.js: les images téléchargées d'avance y sont servies hors ligne
export const IMAGE_CACHE = 'fitgen-images';
// Vêtements ajoutés sur cet appareil mais pas encore envoyés (voir UploadQueue.js)
const PENDING_KEY = 'fitgen-pending';
// Téléchargements en parallèle pendant la synchro
const SYNC_CONCURRENCY = 4;
// Au-delà, on abandonne le cloud et on affiche les images locales
const TIMEOUT = 4000;

// Un vêtement = un id stable + le chemin de ses fichiers sans extension.
// `base` donne `${base}.webp` (1000 px) et `${base}-sm.webp` (500 px).
export const cloudItem = (row) => ({
  id: row.id,
  base: `${STORAGE_URL}/${row.category}/${row.id}`,
  thumb: row.has_thumb ? `${STORAGE_URL}/${row.category}/${row.id}-thumb.webp` : null,
});

// Images de secours livrées avec le site: 0..count-1 dans le dossier de la variante.
// Les ids sont les mêmes que ceux du cloud après la migration (ex: shirts-3).
const localItems = (variant) => {
  const items = [];
  for (let i = 0; i < (variant.count || 0); i++) {
    items.push({
      id: `${variant.name}-${i}`,
      base: `${LOCAL_PATH}/${variant.name}/${i}`,
      thumb: variant.thumbs ? `${LOCAL_PATH}/${variant.thumbs}/${i}-sm.webp` : null,
    });
  }
  return items;
};

async function fetchRows() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/clothes?select=id,category,has_thumb&order=position.asc,created_at.asc`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal },
    );
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Lignes en attente d'envoi: affichées comme les autres (leurs images sont déjà dans le cache)
export function readPendingRows() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY)) || [];
  } catch (error) {
    return [];
  }
}

export function writePendingRows(rows) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(rows));
  } catch (error) {
    // Navigation privée: l'attente durera seulement le temps de la page
  }
}

// Ajoute les vêtements en attente qui ne sont pas encore dans la liste du cloud
const withPending = (rows) => {
  const known = new Set(rows.map((row) => row.id));
  return rows.concat(readPendingRows().filter((row) => !known.has(row.id)));
};

function readSavedRows() {
  try {
    return JSON.parse(localStorage.getItem(CATALOG_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function saveRows(rows) {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(rows));
  } catch (error) {
    // Navigation privée: la liste durera seulement le temps de la page
  }
}

const imageUrls = (rows) =>
  rows.flatMap((row) => {
    const item = cloudItem(row);
    const urls = [`${item.base}.webp`, `${item.base}-sm.webp`];
    if (item.thumb) urls.push(item.thumb);
    return urls;
  });

// Télécharge dans le cache toutes les images qui n'y sont pas encore
// (ex: une veste photographiée sur le cell apparaît sur l'ordi),
// et enlève celles des vêtements supprimés.
async function syncImages(rows) {
  if (!('caches' in window)) return;

  const cache = await caches.open(IMAGE_CACHE);
  const wanted = new Set(imageUrls(rows));
  const cached = new Set((await cache.keys()).map((request) => request.url));

  for (const url of cached) {
    if (!wanted.has(url)) await cache.delete(url);
  }

  const missing = [...wanted].filter((url) => !cached.has(url));
  const worker = async () => {
    while (missing.length) {
      const url = missing.shift();
      try {
        const response = await fetch(url, { mode: 'cors' });
        if (response.ok) await cache.put(url, response);
      } catch (error) {
        // Connexion perdue en route: le reste sera pris à la prochaine visite
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: SYNC_CONCURRENCY }, worker));
}

// Retourne { [nom de variante]: [vêtements] } pour toutes les variantes reçues.
// 1. Cloud joignable: sa liste fait foi, elle est gardée sur l'appareil et
//    toutes les images sont téléchargées en arrière-plan.
// 2. Hors ligne ou projet en pause: la dernière liste gardée (images dans le cache).
// 3. Aucune liste (première visite hors ligne, cloud vide): images locales du site.
export async function loadCatalog(variants) {
  let rows = [];
  try {
    rows = await fetchRows();
    if (rows.length) {
      saveRows(rows);
      rows = withPending(rows);
      // Demande au navigateur de ne pas effacer le cache quand l'espace manque
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      syncImages(rows).catch((error) => console.warn('Synchro des images', error));
    }
  } catch (error) {
    rows = withPending(readSavedRows());
    const source = rows.length ? "liste gardée sur l'appareil" : 'images locales';
    console.warn(`Cloud indisponible: ${source} utilisée.`, error);
  }

  const catalog = {};
  for (const variant of variants) {
    catalog[variant.name] = rows.length
      ? rows.filter((row) => row.category === variant.name).map(cloudItem)
      : localItems(variant);
  }
  return catalog;
}
