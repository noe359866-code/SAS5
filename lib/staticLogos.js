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
  // ── Globales ──────────────────────────────────────────────
  plex: `${IMG}vLZKlXUNDcZR7ilvfY9Wr9k80FZ.jpg`,
  freevee: `${IMG}4VOCKZGiAtXMtoDyOrvHAN33uc2.jpg`,
  roku: `${IMG}wQzSN83BnWVgO7xEh0SeTVqtrFv.jpg`,
  discoveryplus: `${IMG}eMTnWwNVtThkjvQA6zwxaoJG9NE.jpg`,
  // ── Latinoamérica ─────────────────────────────────────────
  vix: `${IMG}jwRPknT20dfU1GeVqbcDXFyvtdG.jpg`,
  clarovideo: `${IMG}21M5CpiOYGOhHj2sVPXqwt6yeTO.jpg`,
  directvgo: `${IMG}nr5UBW4IGKgBwmhpTMOfcvnX2vX.jpg`,
  movistartv: `${IMG}tRNA2CRgA4XHvd7Mx9dH3sFtDVb.jpg`,
  filminlatino: `${IMG}ivrHpNeP8kIMlYNQ7IzKIigVwc1.jpg`,
  globoplay: `${IMG}7Cg8esVVXOijXAm1f1vrS7jVjcN.jpg`,
  // ── España / Europa ───────────────────────────────────────
  filmin: `${IMG}kO2SWXvDCHAquaUuTJBuZkTBAuU.jpg`,
  atresplayer: `${IMG}oN6g8QorcoYo3mx4BulU22ghKq4.jpg`,
  skyshowtime: `${IMG}gQbqEYd0C9uprYxEUqTM589qn8g.jpg`,
  movistarplus: `${IMG}jse4MOi92Jgetym7nbXFZZBI6LK.jpg`,
  // mubi: sin logo público confiable → inicial
};

/**
 * Logos estáticos de ESTUDIOS (TMDB CDN público, w500). Clave = company id
 * de TMDB. Se muestran aunque el despliegue no tenga TMDB_API_KEY; cuando
 * hay clave, branding.js los sustituye por el logo actual de TMDB.
 */
const STUDIO_IMG = 'https://image.tmdb.org/t/p/w500/';
const STATIC_STUDIO_LOGOS = {
  2: `${STUDIO_IMG}wdrCwmRnLFJhEoH8GSfymY85KHT.png`,       // Walt Disney Pictures
  6125: `${STUDIO_IMG}8bH86UPmMP8hlITzXV3XgV9eaAc.png`,    // Walt Disney Animation
  3: `${STUDIO_IMG}1TjvGVDMYsj6JBxOAkUHpPEwLf7.png`,       // Pixar
  1: `${STUDIO_IMG}tlVSws0RvvtPBwViUyOFAO0vcQS.png`,       // Lucasfilm
  420: `${STUDIO_IMG}hUzeosd33nzE5MCNsZxCGEKTXaQ.png`,     // Marvel Studios
  127928: `${STUDIO_IMG}h0rjX5vjW5r8yEnUBStFarjcLT4.png`,  // 20th Century Studios
  174: `${STUDIO_IMG}zhD3hhtKB5qyv7ZeL4uLpNxgMVU.png`,     // Warner Bros.
  12: `${STUDIO_IMG}2ycs64eqV5rqKYHyQK0GVoKGvfX.png`,      // New Line Cinema
  33: `${STUDIO_IMG}8lvHyhjr8oUKOOy2dKXoALWKdp0.png`,      // Universal
  6704: `${STUDIO_IMG}fOG2oY4m1YuYTQh4bMqqZkmgOAI.png`,    // Illumination
  521: `${STUDIO_IMG}3BPX5VGBov8SDqTV7wC1L1xShAS.png`,     // DreamWorks Animation
  4: `${STUDIO_IMG}jay6WcMgagAklUt7i9Euwj1pzTF.png`,       // Paramount Pictures
  5: `${STUDIO_IMG}71BqEFAF4V3qjjMPCpLuyJFB9A.png`,        // Columbia / Sony
  3172: `${STUDIO_IMG}rzKluDcRkIwHZK2pHsiT667A2Kw.png`,    // Blumhouse
};

module.exports = { STATIC_PROVIDER_LOGOS, STATIC_STUDIO_LOGOS };
