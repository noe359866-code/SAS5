'use strict';

/**
 * Logos estáticos de TMDB (CDN público — no requieren clave).
 * Rutas verificadas en producción (cinejoy.pk los sirve igual).
 * Se usan como fallback instantáneo en /configure y en branding.js.
 */

const IMG = 'https://image.tmdb.org/t/p/w154/';

const STATIC_PROVIDER_LOGOS = {
  netflix: `${IMG}rK1KljqmbvO9HQa1PBFLILWah72.png`,
  prime: `${IMG}gMZdpavHmxFNnLpMHwVxfqeux2g.png`,
  disney: `${IMG}5eZ872CghnHFLB1j8grszbrx0dx.png`,
  appletv: `${IMG}9icYBfYFcwgCbky5VdGUIKJ4C5i.png`,
  hulu: `${IMG}44uAnmSqvA4yBOdbPWN8YgQHjWm.png`,
  max: `${IMG}skypuy7SXuugIQeYg0IglmzoKaS.png`,
  paramount: `${IMG}4N4BMd0Mm0kHAmF7RZgL5lW3cwc.png`,
  peacock: `${IMG}a1UIdq5BrkcAxnxcUhFsNbXnxeu.png`,
  crunchyroll: `${IMG}uFL3c4Cq8M6WoLymlC5Y8bmGytV.png`,
  starz: `${IMG}h25xjouKmiSmFiiqw0aDXbxGZo7.png`,
  amcp: `${IMG}wsCUflcmL4dCkzBUaGP8cj1cTkh.png`,
  mgmplus: `${IMG}q63Uzpu7JAs566vA2G23Lk7LcID.png`,
  youtubepremium: `${IMG}eWHpKZihdiY617s5LipWJWvN28U.png`,
  tubi: `${IMG}9dEuvA8wg5TSeFBZlPxSVxFdimJ.png`,
  pluto: `${IMG}fN4czqaMQNLeF6sSSIjGbAWzvwK.png`,
  // mubi: sin logo público confiable → inicial
};

/** Backdrop cinematográfico para el hero (The Odyssey, TMDB CDN público). */
const HERO_BACKDROP = 'https://image.tmdb.org/t/p/w1280/iDiTY1wA35YWzTmXLTtqaxtN6tc.jpg';
const HERO_BACKDROP_SMALL = 'https://image.tmdb.org/t/p/w780/iDiTY1wA35YWzTmXLTtqaxtN6tc.jpg';

module.exports = { STATIC_PROVIDER_LOGOS, HERO_BACKDROP, HERO_BACKDROP_SMALL };
