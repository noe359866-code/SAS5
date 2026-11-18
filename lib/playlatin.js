'use strict';
const { resolutionToken } = require('./resolution');

// PlayLatinSRC identifica por IMDb y capítulo. El token del reproductor
// solo viaja en el POST HTTPS al resolver del mismo sitio.
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
  if (resolved.mediaType !== 'series' || !Number.isSafeInteger(season) || !Number.isSafeInteger(episode) || season < 1 || episode < 1) return null;
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
    endpoint: read('resolve-endpoint') || '/api/resolve',
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
function resolveUrl(page, endpoint) {
  try {
    const url = new URL(endpoint, page);
    if (url.protocol !== 'https:' || url.origin !== new URL(page).origin || url.username || url.password || url.hash || url.search
      || !/^\/api\/(?:[a-z0-9-]+\/)*resolve\/?$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

async function lookupPlayLatin(resolved, provider) {
  const path = pagePath(resolved);
  if (!path) return { reason: 'invalid-id' };
  const page = `${baseUrl()}${path}`;
  const html = await provider.text(page, { headers: HEADERS, maxBytes: 512 * 1024 });
  const shell = parseShell(html);
  if (!shell.present) return { reason: 'missing-player' };
  if (!shell.ok) return { reason: 'missing-token' };
  if (!matchesShell(shell, resolved)) return { reason: 'identity-mismatch' };
  const endpoint = resolveUrl(page, shell.endpoint);
  if (!endpoint) return { reason: 'unsupported-resolver' };

  const payload = await provider.json(endpoint, {
    method: 'POST',
    headers: {
      ...HEADERS,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: page,
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
  if (!payload || payload.ok === false) return { reason: 'resolve-rejected' };
  if (!matchesPayload(payload, resolved)) return { reason: 'identity-mismatch' };
  return { page, payload };
}

async function searchPlayLatin(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (config.playlatinEnabled === false) return { skipped: 'desactivado por PLAYLATIN=off' };
  if (queryTitle && resolved && queryTitle !== resolved.title) return { skipped: 'ya buscado con el título principal' };
  if (!resolved || !resolved.imdbId) return { skipped: 'sin IMDb id' };
  const path = pagePath(resolved);
  if (!path) return { skipped: 'sin temporada/episodio' };

  const label = `playlatin ${resolved.imdbId}`;
  const cacheKey = `playlatin:servers:${baseUrl()}${path}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return { hits: cached, query: label };

  const provider = providerHttp(timeoutMs);
  const missing = (reason) => ({ hits: [], reason, query: label });
  const { payload, reason } = await lookupPlayLatin(resolved, provider);
  if (reason) return missing(reason);
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
  lookupPlayLatin,
  pagePath,
  parseShell,
  normalizeSources,
  serverLabel,
  SERVERS_TTL_SECONDS,
};
