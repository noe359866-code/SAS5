'use strict';

/**
 * PlayLatinSRC (https://playlatinsrc.co): API de streaming en español con
 * **identificación por IMDb** y tres versiones de idioma (Latino, Castellano y
 * Subtitulado) servidas desde el mismo embed. Declara 21.615 películas, 290
 * series y 11.568 episodios.
 *
 * Por qué está aquí teniendo Fanpelis, VideoAPI y Embed69: es el único de los
 * cuatro que identifica por **IMDb** sin PoW y sin clave. VideoAPI solo acepta
 * TMDB (`imdb_supported: false`), así que cuando TMDB no responde ese título se
 * quedaba sin fuentes hispanas; esto lo cubre.
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
 * Cada `source` es un stream: los `kind` mp4/hls van directos y los embeds se
 * entregan con `proxyHeaders` porque los hosts validan `Referer`, igual que
 * los enlaces de Embed69 y VideoAPI.
 *
 * Nota de diseño: el addon **no** reenvía el token a nadie ni lo guarda; solo
 * viaja de la página al resolver dentro de la misma invocación.
 */

const config = require('./config');
const cache = require('./cache');
const { fetchText, fetchJson } = require('./http');

const DEFAULT_BASE = 'https://playlatinsrc.co';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
  Accept: 'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'es-ES,es;q=0.9',
};
const RESOLVE_TIMEOUT_MS = 8000;
// El catálogo cambia a diario, pero el token de resolve es por sesión: se
// cachea poco para no servir enlaces caducados.
const SERVERS_TTL_SECONDS = 30 * 60;
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
  const text = String(html || '');
  const read = (name) => {
    const quoted = new RegExp(`data-${name}\\s*=\\s*"([^"]*)"`, 'i').exec(text);
    if (quoted) return quoted[1];
    const single = new RegExp(`data-${name}\\s*=\\s*'([^']*)'`, 'i').exec(text);
    return single ? single[1] : '';
  };
  const token = read('resolve-token');
  const id = read('id');
  return {
    id: id || '',
    type: (read('type') || '').toLowerCase(),
    season: read('season'),
    episode: read('episode'),
    mode: read('mode') || 'default',
    token,
    // Sin token no hay nada que resolver: es la señal de "captcha/anti-bot".
    ok: Boolean(token && id),
  };
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
    if (!/^https:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const kind = String((source && source.kind) || '').toLowerCase();
    const version = String((source && source.version) || 'latino').toLowerCase();
    out.push({
      url,
      server: serverLabel(source),
      kind: kind === 'mp4' || kind === 'hls' ? kind : 'embed',
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

  const cacheKey = `playlatin:servers:${path}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return { hits: cached, query: `playlatin ${resolved.imdbId}` };

  const label = `playlatin ${resolved.imdbId}`;
  const html = await fetchText(`${baseUrl()}${path}`, { timeoutMs, headers: HEADERS });
  const shell = parseShell(html);
  if (!shell.ok) {
    // Página sin token: o el título no está, o pide captcha. No es un fallo del
    // proveedor (no se pausa), simplemente no hay nada.
    return { hits: [], query: label };
  }

  const payload = await fetchJson(`${baseUrl()}/api/resolve`, {
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
    timeoutMs: RESOLVE_TIMEOUT_MS,
  });
  if (!payload || payload.ok === false) {
    return { hits: [], query: label };
  }

  const hits = normalizeSources(payload).map((entry) => ({
    provider: 'playlatin',
    title: [payload.title || resolved.title, entry.server].filter(Boolean).join(' '),
    url: entry.url,
    audioLabel: entry.label,
    server: entry.server,
    // Un .m3u8/.mp4 se reproduce directo; un iframe es lo que Stremio abre.
    quality: entry.kind === 'hls' || entry.kind === 'mp4' ? 'HLS' : 'Embed',
    referer: `${baseUrl()}/`,
    seeders: 0,
    peers: 0,
    size: 0,
    relevant: true,
  }));
  // Corto: los enlaces de estos hosts caducan con la sesión del reproductor.
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
