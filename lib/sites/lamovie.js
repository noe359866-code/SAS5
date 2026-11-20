'use strict';

/**
 * lamovie.org — el mismo CMS `/wp-api/v1` y el mismo visor Vimeos que
 * Cuevana 3 y Allpelículas (medido el 20-11-2026).
 *
 * El espejo `lamovie.cc` se probó en la misma tanda y no respondió dentro del
 * plazo (AbortError), así que solo se registra el dominio que contesta.
 * Cadena medida: *The Pitt* 1x1 → `vimeos.net` resuelto en ~450 ms
 * (`.probe/vimeos-chain.md`).
 */

const { createVimeosJsonProvider } = require('./vimeosJson');

const provider = createVimeosJsonProvider({
  key: 'lamovie',
  name: 'LaMovie',
  base: 'https://lamovie.org',
  api: 'https://lamovie.org/wp-api/v1',
  dialect: 'wpa',
});

module.exports = {
  BASE: provider.BASE,
  API: provider.API,
  pickPost: provider.pickPost,
  pickEpisode: provider.pickEpisode,
  audioOf: provider.audioOf,
  embedsOf: provider.embedsOf,
  searchLamovie: provider.search,
};
