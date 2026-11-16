import ComponentFactory from './ComponentFactory.js';
import Icons from './utils/Icons.js';

class Main {
  constructor() {
    this.init();
  }

  init() {
    // On ajoute une classe sur le html
    // pour qu'on puisse savoir si le JavaScript est
    // supporté dans notre css

    new ComponentFactory();

    Icons.load();

    // Garde le site et les vêtements sur l'appareil pour marcher sans connexion (voir sw.js)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker', error));
    }
  }
}
new Main();
