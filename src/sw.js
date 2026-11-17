// Service worker: FitGen marche même sans connexion.
//
// - Images du cloud (Supabase): prises dans le cache d'abord. Un id ne change
//   jamais d'image, donc une copie gardée est toujours bonne.
//   Catalog.js télécharge d'avance TOUTES les images dans ce même cache.
// - Le reste du site (html, css, js, images locales): réseau d'abord pour avoir
//   la dernière version, et la copie gardée si le réseau ne répond pas.

const SITE_CACHE = 'fitgen-site';
const IMAGE_CACHE = 'fitgen-images'; // même nom que dans Catalog.js
const CLOUD_IMAGES = '/storage/v1/object/public/clothes/';
// Modèle de détourage (@imgly/background-removal): gros (environ 80 Mo), il ne change
// jamais pour une même version, donc téléchargé une seule fois puis gardé
const TOOLS_CACHE = 'fitgen-tools';
const TOOLS_HOST = 'staticimgly.com';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.pathname.startsWith(CLOUD_IMAGES)) {
    event.respondWith(cacheFirst(IMAGE_CACHE, url.href));
  } else if (url.hostname === TOOLS_HOST) {
    event.respondWith(cacheFirst(TOOLS_CACHE, url.href));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(name, href) {
  const cache = await caches.open(name);
  const cached = await cache.match(href);
  if (cached) return cached;

  // Requête "cors" (pas celle du <img>) pour éviter une réponse opaque,
  // qui compte pour plusieurs Mo dans le quota du navigateur
  const response = await fetch(href, { mode: 'cors' });
  if (response.ok) cache.put(href, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SITE_CACHE);

  try {
    // `no-cache`: toujours demander au serveur si le fichier a changé (GitHub Pages
    // le garde sinon 10 minutes dans le cache du navigateur, même après une mise à jour)
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Page demandée sans index.html dans l'adresse
    if (request.mode === 'navigate') {
      const page = await cache.match(new URL('index.html', self.registration.scope).href);
      if (page) return page;
    }
    throw error;
  }
}
