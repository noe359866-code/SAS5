'use strict';
const { resolutionToken } = require('./resolution');

/**
 * PlayLatinSRC (https://playlatinsrc.co): API de streaming en español con
 * **identificación por IMDb** y tres versiones de idioma (Latino, Castellano y
 * Subtitulado) servidas desde el mismo embed. Declara 21.615 películas, 290
 * series y 11.568 episodios.
 *
 * Junto con Fanpelis, forma el conjunto compacto de fuentes directas seleccionadas.
 * Su búsqueda por IMDb complementa el descubrimiento por título de Fanpelis,
 * sin resolver pruebas de trabajo ni requerir claves.
 *
 * Flujo (leído del reproductor real, `assets/player.js`, nov-2026):
 *
 *   1. GET la página del embed:
 *        /custom/movie/{imdb}                 película
 *        /custom/serial/{imdb}/{temporada}/{e} episodio
 *      Es una cáscara: trae un `.player-shell` con
 *        data-id · data-type · data-season · data-episode · data-resolve-token
 *
 *   2. POST /api/resolve  { type, id, season, episode, mode, token }
 *      → { ok: true, title, sources: [{ id, name, url, version, kind, embed }] }
 *      `url` es el iframe del host (Dropload, Doodstream, Mixdrop…) o, en
 *      algunos títulos, un `.m3u8`/`.mp4` directo (`kind`).
 *
 *   3. Solo entonces se descarta el PoW: no hay que resolverlo aquí, lo hace el
 *      servidor, y el token caduca con la sesión.
 *
 * Solo se entregan URLs de medios directos; un iframe no es un stream.
 *
 * Nota de diseño: el addon **no** reenvía el token a nadie ni lo guarda; solo
 * viaja de la página al resolver dentro de la misma invocación.
 */

const { load } = require('cheerio');
const config = require('./config');
const { isDirectMedia } = require('./directMedia');
const cache = require('./cache');
const { providerHttp } = require('./providerHttp');

const DEFAULT_BASE = 'https://playlatinsrc.co';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
  Accept: 'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'es-ES,es;q=0.9',
};
// El catálogo cambia a diario, pero el token de resolve es por sesión: se
// cachea poco para no servir enlaces caducados.
const SERVERS_TTL_SECONDS = 5 * 60;
const MAX_SERVERS = 4;

/** Idioma de la fuente → etiqueta que entienden filtros e insignias. */
const VERSION_LABELS = { latino: 'Latino', castellano: 'Castellano', subtitulado: 'Subtitulado' };

function baseUrl() {
  return String(config.playlatinUrl || DEFAULT_BASE).replace(/\/+$/, '');
}

/**
 * Ruta del embed. Solo IMDb: es lo único que indexa el servicio.
 * Exportada para pruebas.
 */
function pagePath(resolved) {
  const imdb = String((resolved && resolved.imdbId) || '');
  if (!/^tt\d+$/.test(imdb)) return null;
  if (resolved.mediaType === 'movie') return `/custom/movie/${imdb}`;
  const season = Number(resolved.season);
  const episode = Number(resolved.episode);
  if (!(season >= 1 && episode >= 1)) return null;
  return `/custom/serial/${imdb}/${season}/${episode}`;
}

/**
 * Atributos del `.player-shell` de la página del embed.
 * Exportada para pruebas: es el parser que se rompe si cambian el HTML.
 */
function parseShell(html) {
  const $ = load(String(html || ''));
  const shells = $('.player-shell');
  const shell = shells.length === 1 ? shells.first() : $();
  const read = (name) => String(shell.attr(`data-${name}`) || '').trim();
  const token = read('resolve-token');
  const id = read('id');
  return {
    id,
    type: read('type').toLowerCase(),
    season: read('season'),
    episode: read('episode'),
    mode: read('mode') || 'default',
    token,
    present: shells.length === 1,
    ok: Boolean(token && id),
  };
}

function matchesType(value, mediaType) {
  if (!value) return true;
  const type = String(value).toLowerCase();
  return mediaType === 'movie' ? type === 'movie' : /^(?:series|serial|tv)$/.test(type);
}

function matchesShell(shell, resolved) {
  return shell.id === resolved.imdbId && matchesType(shell.type, resolved.mediaType)
    && (resolved.mediaType === 'movie' || (Number(shell.season) === Number(resolved.season)
      && Number(shell.episode) === Number(resolved.episode)));
}

function matchesPayload(payload, resolved) {
  const imdb = payload.imdb_id || (/^tt\d+$/.test(payload.id || '') ? payload.id : '');
  if ((imdb && imdb !== resolved.imdbId) || !matchesType(payload.type, resolved.mediaType)) return false;
  if (resolved.mediaType === 'movie') return true;
  return ['season', 'episode'].every((key) => payload[key] == null || payload[key] === '' || Number(payload[key]) === Number(resolved[key]));
}

/** Host del iframe, para la etiqueta visible («Dropload», «Doodstream»…). */
function serverLabel(source) {
  const name = String((source && source.name) || '').replace(/\.(?:[a-z]{2,4})$/i, '').trim();
  if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  try {
    return new URL(String((source && source.url) || '')).hostname.replace(/^www\./, '');
  } catch (_) {
    return 'Servidor';
  }
}

/**
 * Normaliza `sources` del resolve. Exportada para pruebas.
 * Descarta lo que no se puede reproducir y máquinas publicitarias.
 */
function normalizeSources(payload, limit = MAX_SERVERS) {
  const list = Array.isArray(payload && payload.sources) ? payload.sources : [];
  const out = [];
  const seen = new Set();
  for (const source of list) {
    const url = String((source && source.url) || '');
    if (source?.embed === true || source?.kind === 'embed' || !/^https:\/\//i.test(url) || !isDirectMedia(url, 'playlatin', false)) continue;
    const version = String((source && source.version) || '').trim().toLowerCase();
    if (!['latino', 'castellano'].includes(version) || seen.has(url)) continue;
    seen.add(url);
    const kind = decodeURIComponent(new URL(url).pathname).split('.').pop().toLowerCase();
    out.push({
      url,
      resolution: resolutionToken(source.resolution, source.height, source.quality),
      server: serverLabel(source),
      kind: kind === 'm3u8' ? 'hls' : kind,
      language: version,
      label: VERSION_LABELS[version] || 'Latino',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Buscador para `/stream/:type/:id`. No busca por texto: el id de IMDb es la
 * consulta, así que solo responde a la pasada principal.
 */
async function searchPlayLatin(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (config.playlatinEnabled === false) return { skipped: 'desactivado por PLAYLATIN=off' };
  if (queryTitle && resolved && queryTitle !== resolved.title) {
    return { skipped: 'ya buscado con el título principal' };
  }
  if (!resolved || !resolved.imdbId) return { skipped: 'sin IMDb id' };
  const path = pagePath(resolved);
  if (!path) return { skipped: 'sin temporada/episodio' };

  const cacheKey = `playlatin:servers:${baseUrl()}${path}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return { hits: cached, query: `playlatin ${resolved.imdbId}` };

  const label = `playlatin ${resolved.imdbId}`;
  const provider = providerHttp(timeoutMs);
  const missing = (reason) => ({ hits: [], reason, query: label });
  const html = await provider.text(`${baseUrl()}${path}`, { headers: HEADERS });
  const shell = parseShell(html);
  if (!shell.present) return missing('missing-player');
  if (!shell.ok) return missing('missing-token');
  if (!matchesShell(shell, resolved)) return missing('identity-mismatch');

  const payload = await provider.json(`${baseUrl()}/api/resolve`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: `${baseUrl()}${path}`,
    },
    body: JSON.stringify({
      type: shell.type || (resolved.mediaType === 'movie' ? 'movie' : 'series'),
      id: shell.id,
      season: shell.season || '',
      episode: shell.episode || '',
      mode: shell.mode,
      token: shell.token,
    }),
  });
  if (!payload || payload.ok === false) return missing('resolve-rejected');
  if (!matchesPayload(payload, resolved)) return missing('identity-mismatch');

  const hits = normalizeSources(payload).map((entry) => ({
    provider: 'playlatin',
    resolution: entry.resolution,
    title: [payload.title || resolved.title, entry.server].filter(Boolean).join(' '),
    url: entry.url,
    audioLabel: entry.label,
    server: entry.server,
    quality: entry.kind.toUpperCase(),
    referer: `${baseUrl()}/`,
    size: 0,
    relevant: true,
  }));
  // El resolver también devuelve iframes o un catálogo vacío. No guardar
  // respuestas negativas: pueden cambiar con el estado de la sesión.
  if (!hits.length) {
    const list = payload.sources;
    return missing(!Array.isArray(list) || !list.length ? 'no-sources'
      : list.every((source) => source?.embed === true || source?.kind === 'embed') ? 'embeds-only' : 'no-compatible-media');
  }
  cache.set(cacheKey, hits, SERVERS_TTL_SECONDS);
  return { hits, query: label };
}

module.exports = {
  searchPlayLatin,
  pagePath,
  parseShell,
  normalizeSources,
  serverLabel,
  SERVERS_TTL_SECONDS,
};
