// Envoie les images locales (src/assets/images/clothes) dans Supabase.
// À lancer une fois:  node tools/migrate-to-supabase.mjs
//
// Demande la clé secrète dans .env.local (jamais commit, voir .gitignore):
//   SUPABASE_SECRET_KEY=sb_secret_...
// Peut être relancé: les fichiers et les lignes existants sont remplacés.

import fs from 'node:fs/promises';
import path from 'node:path';
import { SUPABASE_URL } from '../src/scripts/utils/Catalog.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLOTHES = path.join(ROOT, 'src/assets/images/clothes');
const CATEGORIES = ['heads', 'shirts', 'crewnecks', 'pants', 'shorts', 'shoes', 'coats', 'belts'];
// Vignettes de profil utilisées par le picker
const THUMBS = { shoes: 'shoes/sides' };

async function readSecret() {
  const env = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8').catch(() => '');
  // Accepte "SUPABASE_SECRET_KEY=sb_secret_..." ou la clé seule
  const match = env.match(/^(?:SUPABASE_SECRET_KEY=)?\s*(sb_secret_\S+)/m);
  if (!match) throw new Error('Clé sb_secret_... introuvable dans .env.local');
  return match[1];
}

const key = await readSecret();
const headers = { apikey: key };

async function upload(file, target) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/clothes/${target}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'image/webp',
      // Les ids ne changent jamais d'image: le navigateur peut garder le fichier 1 an
      'Cache-Control': 'max-age=31536000',
      'x-upsert': 'true',
    },
    body: await fs.readFile(file),
  });
  if (!response.ok) throw new Error(`${target}: ${response.status} ${await response.text()}`);
}

const rows = [];

for (const category of CATEGORIES) {
  const files = await fs.readdir(path.join(CLOTHES, category));
  const indexes = files
    .map((name) => name.match(/^(\d+)\.webp$/))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);

  for (const index of indexes) {
    const id = `${category}-${index}`;
    const source = path.join(CLOTHES, category, String(index));

    await upload(`${source}.webp`, `${category}/${id}.webp`);
    await upload(`${source}-sm.webp`, `${category}/${id}-sm.webp`);
    if (THUMBS[category]) {
      await upload(path.join(CLOTHES, THUMBS[category], `${index}-sm.webp`), `${category}/${id}-thumb.webp`);
    }

    rows.push({ id, category, position: index, has_thumb: Boolean(THUMBS[category]) });
    console.log(`✓ ${id}`);
  }
}

const response = await fetch(`${SUPABASE_URL}/rest/v1/clothes`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify(rows),
});
if (!response.ok) throw new Error(`Table clothes: ${response.status} ${await response.text()}`);

console.log(`\n${rows.length} vêtements envoyés dans Supabase.`);
