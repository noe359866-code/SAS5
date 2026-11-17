'use strict';
const config = require('./config');
const catalogs = require('./catalogs');
const tmdb = require('./tmdb');
const core = require('./core');
const { STATIC_PROVIDER_LOGOS } = require('./staticLogos');

const CACHE_HEADERS = {
  catalogs: 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400, stale-if-error=604800',
  catalog: 'public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400, stale-if-error=604800',
  search: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400',
  meta: 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=604800',
  extras: 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=604800',
  episodes: 'public, max-age=3600, s-maxage=43200, stale-while-revalidate=604800, stale-if-error=604800',
  streams: 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400, stale-if-error=86400',
};

/** Public browsing API. Never accepts account credentials or personal configuration. */
async function watchApi(url) {
  const action = url.pathname.split('/').pop();
  const q = url.searchParams;
  const type = q.get('type') === 'series' ? 'series' : 'series' === q.get('media') ? 'series' : 'movie';
  const media = type === 'series' ? 'tv' : 'movie';
  const page = Math.min(500, Math.max(1, Number.parseInt(q.get('page'), 10) || 1));
  const id = q.get('id') || '';
  const result = (body, status = 200) => ({
    body,
    status,
    cacheControl: status === 200 && CACHE_HEADERS[action] ? CACHE_HEADERS[action] : 'no-store',
  });
  if (action === 'catalogs') return result({ catalogs: catalogs.manifestCatalogs(null), configured: config.tmdbConfigured, platforms: catalogs.PLATFORMS.map(p => ({ key: p.key, name: p.name, logo: STATIC_PROVIDER_LOGOS[p.key] || null })) });
  if (!config.tmdbConfigured) return result({ error: 'Configura TMDB_API_KEY o TMDB_ACCESS_TOKEN en el servidor para navegar los catálogos.' }, 503);
  if (action === 'catalog') {
    const def = catalogs.catalogById.get(id);
    if (!def || def.type !== type) return result({ error: 'Catálogo no encontrado.' }, 404);
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
  // La ficha es lo que abre el detalle del reproductor. Se puede pedir sin las
  // claves en la URL (la web ya las tiene en su ficha): así el navegador puede
  // guardarla en caché y cada apertura de /watch deja de costar una invocación.
  if (action === 'meta') return result(await core.handleMeta(type, id));
  if (action === 'extras') {
    let tmdbId = /^tmdb:(?:movie|tv):(\d+)$/.exec(id)?.[1];
    if (!tmdbId && /^tt\d+$/.test(id)) tmdbId = (await tmdb.findByImdbId(id))?.[media]?.id;
    if (!tmdbId) return result({ cast: [], recommendations: [], trailers: [] });
    const data = await tmdb.tmdbGet(`/${media}/${tmdbId}`, { append_to_response: 'credits,recommendations,videos' });
    return result({
      genres: (data?.genres || []).map(g => g.name),
      runtime: data?.runtime || null, language: data?.original_language || null,
      status: data?.status || null, seasons: data?.number_of_seasons || null,
      episodeCount: data?.number_of_episodes || null,
      cast: (data?.credits?.cast || []).slice(0, 12).map(c => ({ name: c.name, character: c.character, image: tmdb.image(c.profile_path, 'w185') })),
      recommendations: (data?.recommendations?.results || []).slice(0, 12).map(i => tmdb.mapTmdbItem(i, media)),
      trailers: (data?.videos?.results || []).filter(v => v.site === 'YouTube' && v.type === 'Trailer' && /^[\w-]{11}$/.test(v.key)).slice(0, 3).map(v => ({ name: v.name, url: `https://www.youtube.com/watch?v=${v.key}` })),
    });
  }
  if (action === 'episodes') {
    let tmdbId = /^tmdb:tv:(\d+)$/.exec(id)?.[1];
    if (!tmdbId && /^tt\d+$/.test(id)) tmdbId = (await tmdb.findByImdbId(id))?.tv?.id;
    if (!tmdbId) return result({ seasons: [], episodes: [] });
    const details = await tmdb.tmdbGet(`/tv/${tmdbId}`);
    const seasons = (details?.seasons || []).filter(s => s.season_number > 0);
    const season = Math.max(1, Math.min(1000, Number.parseInt(q.get('season'), 10) || seasons[0]?.season_number || 1));
    const data = await tmdb.tmdbGet(`/tv/${tmdbId}/season/${season}`);
    return result({ seasons, episodes: (data?.episodes || []).map(e => ({ number: e.episode_number, name: e.name, season, description: e.overview || '', image: tmdb.image(e.still_path), runtime: e.runtime || null, airDate: e.air_date || null })) });
  }
  if (action === 'streams') {
    const season = Math.max(1, Math.min(1000, Number.parseInt(q.get('season'), 10) || 1));
    const episode = Math.max(1, Math.min(10000, Number.parseInt(q.get('episode'), 10) || 1));
    return result(await core.handleStream(type, type === 'series' ? `${id}:${season}:${episode}` : id, null));
  }
  return result({ error: 'Ruta no encontrada.' }, 404);
}
module.exports = { watchApi };
