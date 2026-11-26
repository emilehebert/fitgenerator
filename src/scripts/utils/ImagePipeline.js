// Photo → détourage → recadrage dans le cadre de la catégorie → WebP.
// Tout se passe sur l'appareil: aucun serveur, aucun service payant.

// Cadre de chaque dossier du cloud, mesuré sur les images existantes
// (médiane des 30 chandails, 10 pantalons, etc.):
// `box` = zone où le vêtement est posé (gauche, haut, droite, bas, en fraction du cadre)
// `anchor` = bord du vêtement collé à la zone (le haut d'un chandail, le bas des souliers)
export const FRAMES = {
  shirts: { height: 1000, box: [0.06, 0.12, 0.95, 0.89], anchor: 'top' },
  crewnecks: { height: 1000, box: [0.08, 0.11, 0.92, 0.9], anchor: 'top' },
  coats: { height: 1000, box: [0.03, 0.08, 0.97, 0.92], anchor: 'top' },
  pants: { height: 1000, box: [0.21, 0.025, 0.8, 0.99], anchor: 'top' },
  shorts: { height: 1000, box: [0.17, 0.05, 0.84, 0.64], anchor: 'top' },
  shoes: { height: 500, box: [0.01, 0.13, 0.99, 0.95], anchor: 'bottom' },
  belts: { height: 250, box: [0.26, 0.2, 0.76, 0.48], anchor: 'center' },
};

// Largeurs produites: le site affiche 1000 et 500, le master sert à tout refaire plus tard
const MASTER_WIDTH = 2000;
// Une photo d'iPhone fait 24 à 48 Mpx: on la réduit avant le détourage (mémoire, vitesse)
const MAX_INPUT = 2048;
// Seuil sous lequel un pixel est considéré transparent pour le rognage
const ALPHA_THRESHOLD = 12;

const canvasOf = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const toBlob = (canvas, type) => new Promise((resolve) => canvas.toBlob(resolve, type));

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Réduit la photo (en gardant l'orientation de l'appareil photo, appliquée par le navigateur)
async function shrink(file) {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_INPUT / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = canvasOf(Math.round(image.naturalWidth * scale), Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return toBlob(canvas, 'image/png');
}

// Détourage avec @imgly/background-removal (modèle d'IA dans le navigateur).
// Le modèle est téléchargé une fois puis gardé par le service worker (voir sw.js).
export async function cutOut(file, onProgress) {
  const [{ removeBackground }, input] = await Promise.all([import('@imgly/background-removal'), shrink(file)]);

  const blob = await removeBackground(input, {
    model: 'isnet_fp16',
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      if (onProgress && key.startsWith('fetch:') && total) onProgress(current / total);
    },
  });

  return trim(solidify(await loadImage(blob))).canvas;
}

// Pixel considéré vide (fond), largeur du bord gardé doux, et taille max d'un trou rebouché
const EMPTY_ALPHA = 8;
const EDGE_BAND = 3;
const MAX_HOLE = 0.002;

// Le détourage rend parfois l'intérieur du vêtement à moitié transparent (ex: chemise à carreaux):
// on voyait à travers. Tout ce qui n'est pas le fond (relié au bord de l'image) redevient opaque,
// sauf une fine bande le long du contour pour garder des bords doux.
// Les petits trous vides entourés de tissu sont rebouchés; les grands (ex: entre le bras et le corps) restent.
function solidify(image) {
  const canvas = canvasOf(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const size = width * height;

  // 1. Zones vides: reliées au bord ou grandes = fond; petites et entourées = trou à reboucher
  const outside = new Uint8Array(size);
  const seen = new Uint8Array(size);
  const queue = new Int32Array(size);
  const maxHole = MAX_HOLE * size;
  const isEmpty = (i) => data[i * 4 + 3] < EMPTY_ALPHA;

  for (let start = 0; start < size; start++) {
    if (seen[start] || !isEmpty(start)) continue;
    let head = 0;
    let tail = 0;
    let border = false;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true;
      if (x > 0 && !seen[i - 1] && isEmpty(i - 1)) (seen[i - 1] = 1), (queue[tail++] = i - 1);
      if (x < width - 1 && !seen[i + 1] && isEmpty(i + 1)) (seen[i + 1] = 1), (queue[tail++] = i + 1);
      if (y > 0 && !seen[i - width] && isEmpty(i - width)) (seen[i - width] = 1), (queue[tail++] = i - width);
      if (y < height - 1 && !seen[i + width] && isEmpty(i + width)) (seen[i + width] = 1), (queue[tail++] = i + width);
    }
    if (border || tail > maxHole) for (let k = 0; k < tail; k++) outside[queue[k]] = 1;
  }

  // 2. Distance au fond (en pixels, jusqu'à EDGE_BAND): le bord garde sa transparence douce
  const distance = new Uint8Array(size).fill(255);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < size; i++) if (outside[i]) (distance[i] = 0), (queue[tail++] = i);
  while (head < tail) {
    const i = queue[head++];
    const next = distance[i] + 1;
    if (next > EDGE_BAND) continue;
    const x = i % width;
    for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
      if (j >= 0 && j < size && distance[j] > next) (distance[j] = next), (queue[tail++] = j);
    }
  }

  // 3. Le reste du vêtement devient opaque
  for (let i = 0; i < size; i++) if (distance[i] > EDGE_BAND) data[i * 4 + 3] = 255;
  context.putImageData(imageData, 0, 0);
  return canvas;
}

// Vêtement déjà enregistré: son image (master 2000 px, sinon 1000 px) redevient un détourage,
// avec la place qu'il occupe dans le cadre. Pas de nouveau détourage, mais l'intérieur est rendu
// opaque (solidify): modifier une pièce transparente par endroits la répare.
export async function loadExisting(base) {
  let response = await fetch(`${base}-master.webp`, { mode: 'cors' });
  if (!response.ok) response = await fetch(`${base}.webp`, { mode: 'cors' });
  if (!response.ok) throw new Error(`Image introuvable (${response.status})`);

  const image = await loadImage(await response.blob());
  const { canvas, left, top } = trim(solidify(image));
  const frameWidth = image.naturalWidth;
  return { cutout: canvas, placement: { x: left / frameWidth, y: top / frameWidth, width: canvas.width / frameWidth } };
}

// Coupe le vide transparent autour du vêtement. Retourne le canvas et sa position dans l'image.
function trim(image) {
  const source = canvasOf(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const context = source.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, source.width, source.height);

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error('Aucun vêtement trouvé sur la photo');

  const result = canvasOf(right - left + 1, bottom - top + 1);
  result.getContext('2d').drawImage(source, left, top, result.width, result.height, 0, 0, result.width, result.height);
  return { canvas: result, left, top };
}

// Placement de départ: le vêtement remplit la zone de sa catégorie, comme les images existantes.
// Retourne { x, y, width } en fraction de la largeur du cadre (y aussi, pour garder une seule unité).
export function defaultPlacement(cutout, category) {
  const frame = FRAMES[category];
  const ratio = frame.height / 1000;
  const [left, top, right, bottom] = frame.box;
  const boxWidth = right - left;
  const boxHeight = (bottom - top) * ratio;
  const aspect = cutout.height / cutout.width;

  const width = Math.min(boxWidth, boxHeight / aspect);
  const height = width * aspect;
  const x = left + (boxWidth - width) / 2;
  let y = top * ratio;
  if (frame.anchor === 'bottom') y = bottom * ratio - height;
  if (frame.anchor === 'center') y = top * ratio + (boxHeight - height) / 2;

  return { x, y, width };
}

// Dessine le vêtement dans le cadre à la largeur demandée
function compose(cutout, category, placement, frameWidth) {
  const frame = FRAMES[category];
  const canvas = canvasOf(frameWidth, Math.round((frameWidth * frame.height) / 1000));
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  const width = placement.width * frameWidth;
  context.drawImage(cutout, placement.x * frameWidth, placement.y * frameWidth, width, width * (cutout.height / cutout.width));
  return canvas;
}

// Réduit de moitié en moitié: plus net qu'un seul grand saut
function halve(canvas) {
  const result = canvasOf(Math.round(canvas.width / 2), Math.round(canvas.height / 2));
  const context = result.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, result.width, result.height);
  return result;
}

// WebP avec @jsquash/webp (libwebp de Google en WebAssembly): Safari ne sait pas
// produire de WebP avec canvas.toBlob, il donnerait un PNG.
async function webp(canvas, quality) {
  const { default: encode } = await import('@jsquash/webp/encode.js');
  const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const buffer = await encode(imageData, { quality, alpha_quality: 100, method: 4 });
  return new Blob([buffer], { type: 'image/webp' });
}

// Les 3 fichiers d'un vêtement: 1000 px (affiché), 500 px (vignettes), master 2000 px
export async function exportFiles(cutout, category, placement) {
  const master = compose(cutout, category, placement, MASTER_WIDTH);
  const full = halve(master);
  const small = halve(full);

  const [masterBlob, fullBlob, smallBlob] = await Promise.all([webp(master, 90), webp(full, 82), webp(small, 80)]);
  return { master: masterBlob, full: fullBlob, small: smallBlob };
}
