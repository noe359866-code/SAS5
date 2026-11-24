'use strict';

/**
 * hackstore.mx — CMS `/wp-api/v1` (la misma familia de Cuevana 3,
 * Allpelículas y LaMovie) medido el 24-11-2026:
 *
 *   buscar    -> { data: { posts: [{_id, title, type}] } }
 *   episodios -> { data: { posts: [{_id, season_number, episode_number}] } }
 *   player    -> { data: { embeds: [{url: "https://vimeos.net/embed-….html",
 *                                    lang: "Latino", season, episode}] } }
 *
 * El dominio anterior (`hackstore2.com`) dejó de responder tras el parche PHP
 * de octubre; el actual publica la misma API bajo `hackstore.mx`. La cadena
 * completa con los controles del addon está en `.probe/candidates4.md`.
 */

const { createVimeosJsonProvider } = require('./vimeosJson');

const provider = createVimeosJsonProvider({
  key: 'hackstore',
  name: 'HackStore',
  base: 'https://hackstore.mx',
  api: 'https://hackstore.mx/wp-api/v1',
  dialect: 'wpa',
  maxRequests: 10,
});

module.exports = {
  BASE: provider.BASE,
  API: provider.API,
  pickPost: provider.pickPost,
  pickEpisode: provider.pickEpisode,
  audioOf: provider.audioOf,
  embedsOf: provider.embedsOf,
  searchHackstore: provider.search,
};
