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

  return trim(await loadImage(blob));
}

// Coupe le vide transparent autour du vêtement
function trim(image) {
  const source = canvasOf(image.naturalWidth, image.naturalHeight);
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
  return result;
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
