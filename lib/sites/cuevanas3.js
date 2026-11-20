'use strict';

/**
 * cuevanas3.pro — SPA React sobre una API JSON propia (no se ejecuta JS).
 *
 * Estructura medida el 19-11-2026 con `scripts/sites-probe.mjs` y
 * `scripts/cuevanas3-api-probe.mjs`:
 *
 *   El HTML solo es el armazón de la SPA: la portada publica `window.siteConfig`
 *   con dos bases de datos y la lista de permisos:
 *     fastApi: https://cuevanas3.pro/wp-api/v1     (Laravel, la que usa la SPA)
 *     apiUrl:  https://cuevanas3.pro/wp-json/wpf/v1
 *
 *   GET  {fastApi}/search?q=&page=&postType=any&postsPerPage=18
 *        -> { data: { posts: [{_id, title:"Título (año)", slug, type, release_date}], pagination } }
 *   GET  {fastApi}/player?postId=<_id>
 *        -> { data: { embeds: [{server, provider, language, quality, url, season, episode}],
 *                     downloads: [{…magnet…}] } }
 *        (el parámetro es `postId` en camelCase; `id`/`post_id` responden «Invalid ID»)
 *   GET  {fastApi}/single/episodes/list?_id=<serie>&season=<n>&page=&postsPerPage=
 *        -> { data: { posts: [{_id, season_number, episode_number, …}], seasons } }
 *
 *   El `url` de cada embed es un salto intermedio en otro host
 *   (`https://cuevana3.gs/player.php?…`) cuyo cuerpo es un `<iframe>` al visor
 *   real. En las fichas revisadas el visor fue Vimeos (`vimeos.net/embed-…`),
 *   que el addon ya resuelve sin abrir el manifiesto.
 *
 * Ventaja sobre los scrapeos HTML: la API da ya el idioma («Latino - Inglés»),
 * la calidad y, en series, la temporada y el episodio del embed, así que la
 * identidad se comprueba con esos campos en vez de adivinar slugs.
 *
 * Desde el 20-11-2026 el camino común vive en `lib/sites/vimeosJson.js`, porque
 * `allpeliculas.la` y `lamovie.org` usan el mismo CMS y el mismo visor. Este
 * módulo es la instancia de Cuevana 3 y conserva sus nombres exportados
 * (`BASE`, `FAST`, `pickPost`…) para las pruebas y para `scripts/sites-live.js`.
 */

const { createVimeosJsonProvider } = require('./vimeosJson');

const provider = createVimeosJsonProvider({
  key: 'cuevanas3',
  name: 'Cuevana3',
  base: 'https://cuevanas3.pro',
  api: 'https://cuevanas3.pro/wp-api/v1',
  dialect: 'wpa',
  maxRequests: 10,
});

module.exports = {
  BASE: provider.BASE,
  FAST: provider.API,
  decodeEntities: provider.decodeEntities,
  audioOf: provider.audioOf,
  typesFor: provider.typesFor,
  pickPost: provider.pickPost,
  pickEpisode: provider.pickEpisode,
  embedsOf: provider.embedsOf,
  frameUrls: provider.frameUrls,
  framesOf: provider.framesOf,
  fetchPage: provider.fetchPage,
  mediaOf: provider.mediaOf,
  searchCuevanas3: provider.search,
};
