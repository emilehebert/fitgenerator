const IMAGE_PATH = 'assets/images/clothes';
const FAVORITES_KEY = 'fitgen-favorites';
const HISTORY_LIMIT = 50;

// Chaque catégorie a une ou plusieurs variantes (ex: chandails ou crewnecks).
// `count` = nombre d'images numérotées 0..count-1 dans le dossier de la variante.
// `empty` = image affichée quand la catégorie est vide.
const CATEGORIES = {
  heads: {
    variants: [{ name: 'heads', label: 'Heads', count: 17 }],
  },
  shirts: {
    variants: [
      { name: 'shirts', label: 'Shirts', count: 30, empty: 'ShirtsDefault' },
      { name: 'crewnecks', label: 'Crewnecks', count: 7, empty: 'CrewneckDefault' },
    ],
  },
  pants: {
    variants: [
      { name: 'pants', label: 'Pants', count: 10, empty: 'PantsDefault' },
      { name: 'shorts', label: 'Shorts', count: 8, empty: 'ShortsDefault' },
    ],
  },
  shoes: {
    variants: [
      { name: 'shoes', label: 'Shoes', count: 3, empty: 'ShoesDefault', thumbs: 'shoes/sides' },
    ],
  },
};

export default class Clothes {
  constructor(element) {
    this.element = element;
    this.picker = element.querySelector('.js-picker');
    this.pickerGrid = element.querySelector('.js-picker-grid');
    this.pickerTitle = element.querySelector('.js-picker-title');
    this.pickerVariant = element.querySelector('.js-picker-variant');
    this.pickerToggle = element.querySelector('.js-picker-toggle');
    this.pickerVariantLabel = element.querySelector('.js-picker-variant-label');
    this.shuffleButton = element.querySelector('.js-shuffle-all');
    this.favoriteButton = element.querySelector('.js-favorite');
    this.undoButton = element.querySelector('.js-undo');
    this.redoButton = element.querySelector('.js-redo');

    // `pickerCategory` = catégorie ouverte dans le dialog, ou null pour les favoris
    this.pickerCategory = null;
    this.state = {};
    this.history = [];
    this.historyIndex = -1;
    this.favorites = this.loadFavorites();

    this.init();
  }

  init() {
    const cards = this.element.querySelectorAll('[data-category]');

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      this.state[card.dataset.category] = {
        variant: 0,
        index: null,
        locked: false,
        card,
        image: card.querySelector('.js-image'),
        lockButton: card.querySelector('.js-lock'),
      };
    }

    this.element.addEventListener('click', this.onClick.bind(this));
    this.pickerToggle.addEventListener('change', this.onVariantChange.bind(this));

    this.shuffleAll();
    this.commit();
  }

  onClick(event) {
    const target = event.target;

    if (target === this.picker || target.closest('.js-picker-close')) {
      // Bouton fermer, ou clic sur le fond du dialog
      this.closePicker();
      return;
    }

    if (target.closest('.js-undo')) return this.travel(-1);
    if (target.closest('.js-redo')) return this.travel(1);
    if (target.closest('.js-favorite')) return this.toggleFavorite();
    if (target.closest('.js-open-favorites')) return this.openPicker(null);

    if (target.closest('.js-shuffle-all')) {
      this.shuffleAll();
    } else if (target.closest('.js-clear-all')) {
      this.clearAll();
    } else if (target.closest('.js-picker-item')) {
      this.pick(parseInt(target.closest('.js-picker-item').dataset.index, 10));
    } else {
      const card = target.closest('[data-category]');
      if (!card) return;
      const category = card.dataset.category;

      if (target.closest('.js-lock')) this.toggleLock(category);
      else if (target.closest('.js-prev')) this.step(category, -1);
      else if (target.closest('.js-next')) this.step(category, 1);
      else if (target.closest('.js-pick')) this.openPicker(category);
      else if (target.closest('.js-image')) this.shuffle(category);
    }

    this.commit();
  }

  variantOf(category) {
    return CATEGORIES[category].variants[this.state[category].variant];
  }

  // Retourne false (et fait trembler le cadenas) si la catégorie est barrée
  isFree(category) {
    const state = this.state[category];
    if (!state.locked) return true;

    this.shake(state.lockButton, 'is-shaking');
    return false;
  }

  render(category) {
    const state = this.state[category];
    const variant = this.variantOf(category);
    const isEmpty = state.index === null;
    const file = `${IMAGE_PATH}/${variant.name}/${isEmpty ? variant.empty : state.index}`;

    // Deux tailles par image: le navigateur choisit selon `sizes` (voir index.html) et la densité d'écran
    state.image.srcset = `${file}-sm.webp 500w, ${file}.webp 1000w`;
    state.image.src = `${file}.webp`;
    state.image.alt = isEmpty ? `No ${variant.label.toLowerCase()}` : `${variant.label} ${state.index + 1}`;
  }

  step(category, direction) {
    if (!this.isFree(category)) return;

    const state = this.state[category];
    const count = this.variantOf(category).count;

    if (state.index === null) {
      state.index = direction > 0 ? 0 : count - 1;
    } else {
      state.index = (state.index + direction + count) % count;
    }
    this.render(category);
  }

  shuffle(category) {
    if (!this.isFree(category)) return;

    const state = this.state[category];
    const count = this.variantOf(category).count;
    let index = Math.floor(Math.random() * count);

    // Évite de retomber sur le même vêtement
    if (count > 1 && index === state.index) {
      index = (index + 1 + Math.floor(Math.random() * (count - 1))) % count;
    }

    state.index = index;
    this.render(category);
  }

  shuffleAll() {
    for (const category in this.state) {
      this.shuffle(category);
    }
    this.shake(this.shuffleButton, 'is-bouncing');
  }

  // Vide tous les morceaux non barrés (la tête reste toujours)
  clearAll() {
    for (const category in this.state) {
      if (category === 'heads' || !this.isFree(category)) continue;

      this.state[category].index = null;
      this.render(category);
    }
  }

  toggleLock(category) {
    const state = this.state[category];
    state.locked = !state.locked;

    const label = this.variantOf(category).label.toLowerCase();
    state.lockButton.setAttribute('aria-pressed', state.locked);
    state.lockButton.setAttribute('aria-label', `${state.locked ? 'Unlock' : 'Lock'} ${label}`);
    state.lockButton.querySelector('use').setAttribute('href', state.locked ? '#icon-lock' : '#icon-lock-open');
  }

  /* Historique (flèches du bas)
     ========================================================================== */

  snapshot() {
    const outfit = {};
    for (const category in this.state) {
      outfit[category] = { variant: this.state[category].variant, index: this.state[category].index };
    }
    return outfit;
  }

  // Enregistre la tenue actuelle dans l'historique si elle a changé
  commit() {
    const outfit = this.snapshot();
    const key = JSON.stringify(outfit);

    if (key !== JSON.stringify(this.history[this.historyIndex])) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(outfit);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.historyIndex = this.history.length - 1;
    }

    this.updateToolbar();
  }

  travel(direction) {
    const index = this.historyIndex + direction;
    if (index < 0 || index >= this.history.length) return;

    this.historyIndex = index;
    this.restore(this.history[index]);
  }

  restore(outfit) {
    for (const category in outfit) {
      if (!this.state[category]) continue;

      this.state[category].variant = outfit[category].variant;
      this.state[category].index = outfit[category].index;
      this.render(category);
    }
    this.updateToolbar();
  }

  updateToolbar() {
    this.undoButton.disabled = this.historyIndex <= 0;
    this.redoButton.disabled = this.historyIndex >= this.history.length - 1;

    const saved = this.favoriteIndex() !== -1;
    this.favoriteButton.setAttribute('aria-pressed', saved);
    this.favoriteButton.setAttribute('aria-label', saved ? 'Remove from saved outfits' : 'Save outfit');
    this.favoriteButton.querySelector('use').setAttribute('href', saved ? '#icon-star-filled' : '#icon-star');
  }

  /* Favoris (étoile et grille du bas), gardés dans le localStorage
     ========================================================================== */

  loadFavorites() {
    try {
      return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
    } catch (error) {
      return [];
    }
  }

  saveFavorites() {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(this.favorites));
    } catch (error) {
      // Navigation privée: les favoris durent seulement le temps de la page
    }
  }

  favoriteIndex() {
    const key = JSON.stringify(this.snapshot());
    return this.favorites.findIndex((outfit) => JSON.stringify(outfit) === key);
  }

  toggleFavorite() {
    const index = this.favoriteIndex();

    if (index === -1) this.favorites.unshift(this.snapshot());
    else this.favorites.splice(index, 1);

    this.saveFavorites();
    this.updateToolbar();
  }

  /* Dialog de sélection: un vêtement d'une catégorie, ou une tenue sauvegardée
     ========================================================================== */

  openPicker(category) {
    if (category && !this.isFree(category)) return;

    this.pickerCategory = category;
    if (category) this.renderPicker();
    else this.renderFavorites();
    this.picker.showModal();
  }

  closePicker() {
    this.picker.close();
    this.pickerCategory = null;
  }

  renderPicker() {
    const category = this.pickerCategory;
    const { variants } = CATEGORIES[category];
    const variant = this.variantOf(category);
    const folder = variant.thumbs || variant.name;

    this.pickerTitle.textContent = `Your ${variant.label.toLowerCase()}`;

    // La case à cocher ne sert que pour les catégories à deux variantes
    this.pickerVariant.hidden = variants.length < 2;
    if (variants.length > 1) {
      this.pickerVariantLabel.textContent = variants[1].label;
      this.pickerToggle.checked = this.state[category].variant === 1;
    }

    this.pickerGrid.className = `picker__grid js-picker-grid${variant.thumbs ? ' picker__grid--wide' : ''}`;
    this.pickerGrid.innerHTML = '';

    for (let i = 0; i < variant.count; i++) {
      const button = this.createPickerItem(i, i === this.state[category].index);
      button.innerHTML = `<img src="${IMAGE_PATH}/${folder}/${i}-sm.webp" alt="${variant.label} ${i + 1}" width="500" height="${variant.thumbs ? 250 : 500}" loading="lazy" />`;
      this.pickerGrid.appendChild(button);
    }
  }

  renderFavorites() {
    this.pickerTitle.textContent = 'Saved outfits';
    this.pickerVariant.hidden = true;
    this.pickerGrid.className = 'picker__grid picker__grid--outfits js-picker-grid';
    this.pickerGrid.innerHTML = '';

    if (!this.favorites.length) {
      this.pickerGrid.innerHTML = '<p class="picker__empty">No saved outfits yet. Press the star to save the current one.</p>';
      return;
    }

    const current = this.favoriteIndex();

    for (let i = 0; i < this.favorites.length; i++) {
      const outfit = this.favorites[i];
      const button = this.createPickerItem(i, i === current);
      const images = Object.keys(CATEGORIES).map((category) => {
        const variant = CATEGORIES[category].variants[outfit[category].variant];
        const file = outfit[category].index === null ? variant.empty : outfit[category].index;
        return `<img class="outfit__${category}" src="${IMAGE_PATH}/${variant.name}/${file}-sm.webp" alt="" loading="lazy" />`;
      });

      button.setAttribute('aria-label', `Saved outfit ${i + 1}`);
      button.innerHTML = `<span class="outfit">${images.join('')}</span>`;
      this.pickerGrid.appendChild(button);
    }
  }

  createPickerItem(index, selected) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker__item js-picker-item';
    button.dataset.index = index;
    button.classList.toggle('is-selected', selected);
    return button;
  }

  onVariantChange() {
    const category = this.pickerCategory;
    const state = this.state[category];

    state.variant = this.pickerToggle.checked ? 1 : 0;
    state.index = null;
    this.render(category);
    this.renderPicker();
    this.commit();
  }

  pick(index) {
    if (this.pickerCategory) {
      this.state[this.pickerCategory].index = index;
      this.render(this.pickerCategory);
    } else {
      this.restore(this.favorites[index]);
    }
    this.closePicker();
  }

  // Relance une animation CSS même si elle est déjà en cours
  shake(element, className) {
    if (!element) return;

    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    element.addEventListener('animationend', () => element.classList.remove(className), { once: true });
  }
}
