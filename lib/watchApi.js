'use strict';
const config = require('./config');
const catalogs = require('./catalogs');
const tmdb = require('./tmdb');
const core = require('./core');

/** Public browsing API. Never accepts account credentials or personal configuration. */
async function watchApi(url) {
  const action = url.pathname.split('/').pop();
  const q = url.searchParams;
  const type = q.get('type') === 'series' ? 'series' : 'movie';
  const media = type === 'series' ? 'tv' : 'movie';
  const page = Math.min(500, Math.max(1, Number.parseInt(q.get('page'), 10) || 1));
  const id = q.get('id') || '';
  const result = (body, status = 200) => ({ body, status });
  if (action === 'catalogs') return result({ catalogs: catalogs.manifestCatalogs(null), configured: config.tmdbConfigured });
  if (!config.tmdbConfigured) return result({ error: 'Configura TMDB_API_KEY o TMDB_ACCESS_TOKEN en el servidor para navegar los catálogos.' }, 503);
  if (action === 'catalog') {
    const def = catalogs.buildDefs(null).find(d => d.id === id && d.type === type);
    if (!def) return result({ error: 'Catálogo no encontrado.' }, 404);
    if (def.source === 'tvmaze') return result({ ...(await core.handleCatalog(type, id)), hasMore: false });
    const regions = def.kind === 'platform' ? [...new Set([config.watchRegion, ...(config.watchRegionFallback || [])])] : [config.watchRegion];
    let metas = [];
    // Choose the fallback region from page one, so later pages cannot repeat a different region.
    for (const region of regions) {
      const first = await tmdb.catalogItems(def, { region, page: 1, web: true });
      if (first.length) { metas = page === 1 ? first : await tmdb.catalogItems(def, { region, page, web: true }); break; }
    }
    return result({ metas, hasMore: metas.length >= 20 && page < 500 });
  }
  if (action === 'search') {
    const query = (q.get('q') || '').trim().slice(0, 150);
    if (!query) return result({ metas: [], hasMore: false });
    const data = await tmdb.tmdbGet(`/search/${media}`, { query, page, include_adult: false });
    return result({ metas: (data?.results || []).map(i => tmdb.mapTmdbItem(i, media)), hasMore: page < (data?.total_pages || 0) });
  }
  if (!/^tmdb:(movie|tv):\d+$/.test(id) && !/^tt\d+$/.test(id) && !/^tvmaze:\d+$/.test(id)) return result({ error: 'Identificador inválido.' }, 400);
  if (action === 'meta') return result(await core.handleMeta(type, id));
  if (action === 'episodes') {
    let tmdbId = /^tmdb:tv:(\d+)$/.exec(id)?.[1];
    if (!tmdbId && /^tt\d+$/.test(id)) tmdbId = (await tmdb.findByImdbId(id))?.tv?.id;
    if (!tmdbId) return result({ seasons: [], episodes: [] });
    const details = await tmdb.tmdbGet(`/tv/${tmdbId}`);
    const seasons = (details?.seasons || []).filter(s => s.season_number > 0);
    const season = Math.max(1, Math.min(1000, Number.parseInt(q.get('season'), 10) || seasons[0]?.season_number || 1));
    const data = await tmdb.tmdbGet(`/tv/${tmdbId}/season/${season}`);
    return result({ seasons, episodes: (data?.episodes || []).map(e => ({ number: e.episode_number, name: e.name, season })) });
  }
  if (action === 'streams') {
    const season = Math.max(1, Math.min(1000, Number.parseInt(q.get('season'), 10) || 1));
    const episode = Math.max(1, Math.min(10000, Number.parseInt(q.get('episode'), 10) || 1));
    return result(await core.handleStream(type, type === 'series' ? `${id}:${season}:${episode}` : id, null));
  }
  return result({ error: 'Ruta no encontrada.' }, 404);
}
module.exports = { watchApi };
