'use strict';

/**
 * allcalidad.re — variante `rest` de la familia `/wp-api/v1` medida el
 * 24-11-2026:
 *
 *   buscar    -> { data: { posts: [{_id, title, type}] } }
 *   episodios -> { data: [{_id, season_number, episode_number, …}] }
 *   player    -> { data: { embeds: [{url: "https://vimeos.net/embed-….html",
 *                                    lang: "latino", quality: "Full HD"}] } }
 *
 * A diferencia del dialecto `wpa`, el listado de episodios es un array directo
 * dentro de `data` (lo acepta `lib/sites/vimeosJson.js`). Es el mismo visor
 * Vimeos que ya resuelve el addon, con un catálogo propio.
 */

const { createVimeosJsonProvider } = require('./vimeosJson');

const provider = createVimeosJsonProvider({
  key: 'allcalidad',
  name: 'AllCalidad',
  base: 'https://allcalidad.re',
  api: 'https://allcalidad.re/api/rest',
  dialect: 'rest',
  maxRequests: 10,
});

module.exports = {
  BASE: provider.BASE,
  API: provider.API,
  pickPost: provider.pickPost,
  pickEpisode: provider.pickEpisode,
  audioOf: provider.audioOf,
  embedsOf: provider.embedsOf,
  searchAllcalidad: provider.search,
};
