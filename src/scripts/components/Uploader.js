// Fenêtre « Add »: connexion → photo → détourage → ajustement sur le bonhomme → envoi.
// Ouverte par Clothes.js avec la catégorie du picker.

import { sendLink, currentSession, isAdmin } from '../utils/Supabase.js';
import { cutOut, loadExisting, defaultPlacement, exportFiles, FRAMES } from '../utils/ImagePipeline.js';
import { enqueue, replace } from '../utils/UploadQueue.js';

// Zoom permis autour du placement de départ
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;

export default class Uploader {
  constructor(element, { onAdded, onReplaced }) {
    this.element = element;
    this.onAdded = onAdded;
    this.onReplaced = onReplaced;
    this.title = element.querySelector('.js-uploader-title');
    this.message = element.querySelector('.js-uploader-message');
    this.steps = element.querySelectorAll('[data-step]');
    this.emailInput = element.querySelector('.js-uploader-email');
    this.sourcesBox = element.querySelector('.js-uploader-sources');
    this.progress = element.querySelector('.js-uploader-progress');
    this.status = element.querySelector('.js-uploader-status');
    this.stage = element.querySelector('.js-uploader-stage');
    this.reference = element.querySelector('.js-uploader-reference');
    this.preview = element.querySelector('.js-uploader-preview');
    this.zoomInput = element.querySelector('.js-uploader-zoom');

    // `pointers` = doigts posés sur la scène (déplacer avec un, zoomer avec deux)
    this.pointers = new Map();
    this.gesture = null;

    element.addEventListener('click', this.onClick.bind(this));
    element.addEventListener('submit', this.onSubmit.bind(this));
    element.addEventListener('change', this.onChange.bind(this));
    this.zoomInput.addEventListener('input', () => this.setZoom(Number(this.zoomInput.value) / 100));
    this.stage.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.stage.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.stage.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.stage.addEventListener('pointercancel', this.onPointerUp.bind(this));
  }

  // `sources` = dossiers possibles [{ name, label }], `reference` = image du bonhomme vide,
  // `item` = vêtement existant à modifier (sinon on en ajoute un nouveau)
  async open({ label, title, sources, reference, item = null }) {
    this.sources = sources;
    this.source = item ? item.category : sources[0].name;
    this.item = item;
    this.reference.src = reference;
    this.title.textContent = title || `${item ? 'Edit' : 'Add'} ${label.toLowerCase()}`;
    this.renderSources();
    this.element.showModal();

    const session = await currentSession();
    if (!session) return this.show('login');
    // Connecté, mais seul le compte autorisé peut ajouter (vérifié aussi par Supabase à l'envoi)
    try {
      if (!(await isAdmin())) return this.show('login', 'This account is not allowed to change clothes.');
    } catch (error) {
      // Hors ligne: impossible de vérifier, l'ajout attendra dans la file d'envoi
    }
    if (!item) return this.show('source');

    // Modifier: l'image actuelle revient sur le bonhomme, à sa place et à sa taille
    this.show('working');
    this.setProgress(1, '');
    this.status.textContent = 'Loading the piece…';
    try {
      const { cutout, placement } = await loadExisting(item.base);
      this.cutout = cutout;
      this.startAdjust(placement);
    } catch (error) {
      console.error(error);
      this.show('source', 'Could not load this piece. Take a new photo instead.');
    }
  }

  close() {
    this.element.close();
    this.cutout = null;
  }

  show(step, message = '') {
    for (const section of this.steps) section.hidden = section.dataset.step !== step;
    this.message.textContent = message;
    this.message.hidden = !message;
  }

  renderSources() {
    this.sourcesBox.hidden = this.sources.length < 2;
    this.sourcesBox.innerHTML = '';
    for (const source of this.sources) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'picker__tab js-uploader-source';
      button.dataset.source = source.name;
      button.textContent = source.label;
      button.setAttribute('aria-pressed', source.name === this.source);
      this.sourcesBox.appendChild(button);
    }
  }

  onClick(event) {
    const target = event.target;
    if (target === this.element || target.closest('.js-uploader-close')) return this.close();

    const source = target.closest('.js-uploader-source');
    if (source) {
      this.source = source.dataset.source;
      this.renderSources();
    }
    if (target.closest('.js-uploader-retake')) this.show('source');
    if (target.closest('.js-uploader-save')) this.save();
  }

  /* Connexion par lien reçu par courriel
     ========================================================================== */

  async onSubmit(event) {
    event.preventDefault();
    const email = this.emailInput.value.trim();

    try {
      await sendLink(email);
      this.show('login', `Link sent to ${email}. Open it on this device to sign in.`);
    } catch (error) {
      // Compte inconnu (inscriptions fermées) ou trop de demandes
      const refused = /signups not allowed|not found/i.test(error.message || '');
      this.show('login', refused ? 'This email is not allowed to add clothes.' : error.message || 'Something went wrong. Try again.');
    }
  }

  /* Photo → détourage
     ========================================================================== */

  async onChange(event) {
    const input = event.target.closest('.js-uploader-file');
    if (!input || !input.files.length) return;
    const file = input.files[0];
    input.value = '';

    this.show('working');
    this.setProgress(0, 'Downloading the cutout model (first time only)…');

    try {
      this.cutout = await cutOut(file, (ratio) => this.setProgress(ratio, 'Downloading the cutout model (first time only)…'));
      this.startAdjust();
    } catch (error) {
      console.error(error);
      this.show('source', 'The cutout did not work. Try a photo on a plain background.');
    }
  }

  setProgress(ratio, text) {
    this.progress.value = ratio;
    this.status.textContent = ratio >= 1 ? 'Removing the background…' : text;
  }

  /* Ajustement: le vêtement est posé sur le bonhomme, on le déplace et le zoome
     ========================================================================== */

  // `placement`: position de départ (modification), sinon la place standard de la catégorie.
  // Le curseur à 100 % = taille standard: pratique pour remettre une pièce à la taille des autres.
  startAdjust(placement = null) {
    const frame = FRAMES[this.source];
    this.stage.style.aspectRatio = `1000 / ${frame.height}`;
    this.preview.src = this.cutout.toDataURL('image/png');
    this.base = defaultPlacement(this.cutout, this.source);
    this.placement = { ...(placement || this.base) };
    this.zoomInput.value = Math.round((this.placement.width / this.base.width) * 100);
    this.show('adjust');
    this.renderPlacement();
  }

  renderPlacement() {
    const width = this.stage.clientWidth;
    const { x, y } = this.placement;
    this.preview.style.width = `${this.placement.width * width}px`;
    this.preview.style.transform = `translate(${x * width}px, ${y * width}px)`;
  }

  // Zoom autour du centre du vêtement
  setZoom(zoom) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const aspect = this.cutout.height / this.cutout.width;
    const centerX = this.placement.x + this.placement.width / 2;
    const centerY = this.placement.y + (this.placement.width * aspect) / 2;
    const width = this.base.width * zoom;

    this.placement = { x: centerX - width / 2, y: centerY - (width * aspect) / 2, width };
    this.zoomInput.value = Math.round(zoom * 100);
    this.renderPlacement();
  }

  onPointerDown(event) {
    if (!this.cutout) return;
    this.stage.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.startGesture();
  }

  onPointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const width = this.stage.clientWidth;
    const points = [...this.pointers.values()];
    const center = midpoint(points);
    const { start } = this.gesture;

    let zoom = start.zoom;
    if (points.length > 1 && this.gesture.distance) zoom = start.zoom * (distance(points) / this.gesture.distance);
    this.setZoom(zoom);

    // Déplacement: suit le doigt (ou le milieu des deux doigts)
    this.placement.x += (center.x - this.gesture.center.x) / width;
    this.placement.y += (center.y - this.gesture.center.y) / width;
    this.gesture.center = center;
    this.renderPlacement();
  }

  onPointerUp(event) {
    this.pointers.delete(event.pointerId);
    this.startGesture();
  }

  startGesture() {
    const points = [...this.pointers.values()];
    this.gesture = points.length
      ? {
          center: midpoint(points),
          distance: points.length > 1 ? distance(points) : 0,
          start: { zoom: this.placement.width / this.base.width },
        }
      : null;
  }

  /* Enregistrer: WebP 500 / 1000 / 2000 px, puis file d'envoi
     ========================================================================== */

  async save() {
    this.show('working');
    this.setProgress(1, '');
    this.status.textContent = 'Saving…';

    try {
      const files = await exportFiles(this.cutout, this.source, this.placement);
      const row = { id: crypto.randomUUID(), category: this.source, position: Math.floor(Date.now() / 1000) - 1700000000, has_thumb: false };

      // Modifier = nouvelle version (nouvel id: les appareils qui ont l'ancienne en cache la remplacent),
      // puis l'ancienne est supprimée
      if (this.item) {
        const old = { id: this.item.id, category: this.item.category };
        await replace(old, row, files);
        this.onReplaced(old, row);
        this.close();
        return;
      }

      const left = await enqueue(row, files);
      this.onAdded(row);
      this.close();
      if (left) console.info(`${left} vêtement(s) en attente d'envoi: ils partiront au retour d'Internet.`);
    } catch (error) {
      console.error(error);
      this.show('adjust', 'Saving did not work. Try again.');
    }
  }
}

const midpoint = (points) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

const distance = ([a, b]) => Math.hypot(a.x - b.x, a.y - b.y);
