'use strict';

/**
 * VideoAPI (https://videoapi.la): API **pública y documentada** de embeds en
 * español (latino y castellano, con subtítulos) identificados por **TMDB**.
 * Declara 89.155 películas, 19.012 series, 3.240 animes y 464.692 episodios.
 *
 * Por qué está aquí teniendo Embed69 y SpinFlix: es el único de los tres que
 * **no resuelve ningún PoW**. Son dos GET y nada más, así que entra sin tocar
 * el presupuesto de CPU del plan Free (Embed69 con dificultad 5 son ~8,8 s de
 * SHA-256; esto son ~2 × 10 ms).
 *
 * Flujo (verificado nov-2026 contra el servicio real):
 *
 *   1. GET /api/v1/public/exists/movie/{tmdb}
 *      GET /api/v1/public/exists/series/{tmdb}/{temporada}/{episodio}
 *      → { "exists": true, "path": "/e/movie/157336" }
 *      → { "exists": false } si no la tiene (un solo GET, no se sigue).
 *
 *   2. GET {base}{path} → la página del reproductor. Ahí está el iframe real
 *      (`id="frame"`), que apunta a lamovie.link o vimeos.net: el MISMO host
 *      que ya sabemos extraer y proxear para SpinFlix. Ese iframe es el stream.
 *
 * Solo identifica por TMDB (`imdb_supported: false`), y el addon recibe IMDb:
 * se resuelve con `resolved.tmdbId`, que `resolveTitle` ya rellena.
 *
 * El reproductor valida `Origin`/`Referer` y exige el atributo
 * `referrerpolicy="origin"`: por eso el stream se entrega con `proxyHeaders`,
 * igual que los enlaces de Embed69.
 */

const config = require('./config');
const cache = require('./cache');
const { fetchJson, fetchText } = require('./http');

const DEFAULT_BASE = 'https://videoapi.la';
const HEADERS = {
  // El reproductor valida el origen: sin Referer de la propia API responde
  // «contenido no disponible» en vez del iframe.
  'User-Agent': 'Mozilla/5.0 (compatible; CatalogosPlus/1.5; +https://github.com/noe359866-code/SAS5)',
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  Referer: `${DEFAULT_BASE}/`,
};
// `exists` cambia poco (el catálogo se actualiza a diario) y es lo que ahorra
// el segundo GET cuando la obra no está: 24 h es de sobra.
const EXISTS_TTL_SECONDS = 24 * 3600;
// El iframe sí lleva token de sesión del reproductor: corto, como SpinFlix.
const EMBED_TTL_SECONDS = 2 * 3600;
const MAX_SERVERS = 3;

/** Hosts del reproductor final; el resto de iframes son anuncios. */
const PLAYER_HOSTS = /^https:\/\/(?:lamovie\.link|vimeos\.net)(?:[/?#]|$)/i;

function baseUrl() {
  return String(config.videoapiUrl || DEFAULT_BASE).replace(/\/+$/, '');
}

/**
 * Ruta pública de `exists` para una obra resuelta. Solo TMDB: si el título
 * llegó por IMDb y TMDB no respondió, no hay nada que preguntar (y no se
 * inventa una búsqueda por texto que la API no ofrece).
 */
function existsUrl(resolved) {
  const tmdb = Number(resolved && resolved.tmdbId);
  if (!Number.isInteger(tmdb) || tmdb <= 0) return null;
  const base = baseUrl();
  if (resolved.mediaType === 'movie') return `${base}/api/v1/public/exists/movie/${tmdb}`;
  const season = Number(resolved.season);
  const episode = Number(resolved.episode);
  if (!(season >= 1 && episode >= 1)) return null;
  return `${base}/api/v1/public/exists/series/${tmdb}/${season}/${episode}`;
}

/**
 * Normaliza la respuesta de `exists` a una ruta interna absoluta.
 * Exportada para pruebas: es el contrato que puede cambiar sin avisar.
 *
 * Ojo: la API responde `{exists:true, path:"/e/movie/157336"}` pero el
 * documento habla de `/e/tv/…` para series; se aceptan las dos formas y
 * también `/e/series/…` por si la normalizan algún día.
 */
function playerPath(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  if (data.exists !== true) return null;
  const path = String(data.path || '');
  if (!/^\/e\/(?:movie|tv|series)\/\d+(?:\/\d+\/\d+)?$/.test(path)) return null;
  return path;
}

/**
 * iframes del reproductor → URLs jugables. El bueno lleva `id="frame"`; se
 * acepta cualquier iframe cuyo host sea del reproductor por si cambian el id.
 * Exportada para pruebas.
 */
function playerFrames(html, pageUrl) {
  const text = String(html || '');
  const found = [];
  for (const match of text.matchAll(/<iframe\b[^>]*>/gi)) {
    const tag = match[0];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!src) continue;
    let url;
    try {
      url = new URL(src[1].replace(/&amp;/g, '&'), pageUrl).toString();
    } catch (_) {
      continue;
    }
    if (!/^https:/i.test(url) || !PLAYER_HOSTS.test(url)) continue;
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!found.some((seen) => seen.url === url)) {
      found.push({ url, id: id ? id[1] : '' });
    }
  }
  // Primero el iframe canónico (`id="frame"`), luego el resto.
  return found.sort((a, b) => Number(b.id === 'frame') - Number(a.id === 'frame')).slice(0, MAX_SERVERS);
}

/** `{exists, path}` con caché de 24 h (negativos incluidos). */
async function availability(resolved, timeoutMs) {
  const url = existsUrl(resolved);
  if (!url) return { skipped: 'sin TMDB id (VideoAPI solo identifica por TMDB)' };
  const cacheKey = `videoapi:exists:${url}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const payload = await fetchJson(url, { timeoutMs, headers: { ...HEADERS, Referer: `${DEFAULT_BASE}/api` } });
  const result = { path: playerPath(payload) };
  cache.set(cacheKey, result, EXISTS_TTL_SECONDS);
  return result;
}

/**
 * Buscador para `/stream/:type/:id`. Como Embed69, no busca por texto: la
 * consulta es el propio id de TMDB, así que la pasada con el título
 * alternativo no aporta nada y se salta.
 */
async function searchVideoApi(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (config.videoapiEnabled === false) return { skipped: 'desactivado por VIDEOAPI=off' };
  if (queryTitle && resolved && queryTitle !== resolved.title) {
    return { skipped: 'ya buscado con el título principal' };
  }
  if (!resolved) return { skipped: 'sin título resuelto' };
  if (resolved.mediaType !== 'movie' && !(resolved.season >= 1 && resolved.episode >= 1)) {
    return { skipped: 'sin temporada/episodio' };
  }
  const available = await availability(resolved, timeoutMs);
  if (available.skipped) return available;
  if (!available.path) return { hits: [], query: `videoapi tmdb:${resolved.tmdbId}` };

  const pageUrl = `${baseUrl()}${available.path}`;
  const cacheKey = `videoapi:embed:${pageUrl}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const html = await fetchText(pageUrl, { timeoutMs, headers: HEADERS });
  const frames = playerFrames(html, pageUrl);
  const label = resolved.mediaType === 'movie' ? 'Latino' : 'Latino';
  const hits = frames.map((frame) => ({
    provider: 'videoapi',
    title: [resolved.title, resolved.year, label].filter(Boolean).join(' '),
    url: frame.url,
    referer: pageUrl,
    audioLabel: label,
    seeders: 0,
    peers: 0,
    size: 0,
    relevant: true,
  }));
  const result = { hits, query: `videoapi tmdb:${resolved.tmdbId}` };
  cache.set(cacheKey, result, EMBED_TTL_SECONDS);
  return result;
}

module.exports = {
  searchVideoApi,
  existsUrl,
  playerPath,
  playerFrames,
  PLAYER_HOSTS,
  MAX_SERVERS,
};
