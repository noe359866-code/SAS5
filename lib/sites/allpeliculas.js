'use strict';

/**
 * allpeliculas.la — mismo CMS que Cuevana 3 (`/wp-api/v1`) y mismo visor
 * (Vimeos), medido el 20-11-2026:
 *
 *   buscar    -> { data: { posts: [{_id, title, type}] } }
 *   episodios -> { data: { posts: [{_id, season_number, episode_number}] } }
 *   player    -> { data: { embeds: [{url: "https://vimeos.net/embed-….html",
 *                                    lang: "Latino", quality: "Full HD"}] } }
 *
 * La cadena completa (buscar → episodio → player → Vimeos resuelto) está en
 * `.probe/vimeos-chain.md`: 1x1 de *The Pitt* en ~500 ms desde el runner.
 * El camino común vive en `lib/sites/vimeosJson.js`.
 */

const { createVimeosJsonProvider } = require('./vimeosJson');

const provider = createVimeosJsonProvider({
  key: 'allpeliculas',
  name: 'Allpelículas',
  base: 'https://allpeliculas.la',
  api: 'https://allpeliculas.la/wp-api/v1',
  dialect: 'wpa',
});

module.exports = {
  BASE: provider.BASE,
  API: provider.API,
  pickPost: provider.pickPost,
  pickEpisode: provider.pickEpisode,
  audioOf: provider.audioOf,
  embedsOf: provider.embedsOf,
  searchAllpeliculas: provider.search,
};
