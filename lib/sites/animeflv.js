'use strict';

/**
 * animeflv.or.at — WordPress con el tema AnimeFLV/AnimeAV1, solo subtitulado.
 *
 * Estructura medida el 19-11-2026 con `scripts/sites-probe.mjs`:
 *   ficha     `/anime/<slug>/`  → `h1.anime-title` con el nombre limpio y
 *             `og:title` «Ver <título> Online Sub Español - AnimeFLV».
 *             No publica año: la identidad se comprueba solo por título.
 *   episodios  JSON embebido en `.animeflv-episodes-data`:
 *             `[{post_id, permalink, number, range}]`, con enlaces del tipo
 *             `/2026/11/15/<slug>-episodio-7/` (permisos de WordPress).
 *   episodio  botones `button.iframe_code[data-src]` con el embed en **base64**
 *             y el nombre del visor en el `.tooltip-text` hermano. Todos van
 *             marcados `app_type="Sub"`: audio original con subtítulos en
 *             español, que el addon publica con la etiqueta «Subtitulado».
 *
 *   Visores vistos: `player.zilla-networks.com/m3u8/<token>` (HLS servido sin
 *   extensión), Byse (extraíble), UPNShare, Voe y MP4Upload (opacos).
 *
 * El buscador del sitio (`/search/<término>/`) devuelve el archivo completo en
 * vez de filtrar, así que se usa solo como respaldo: se pide y se elige la
 * ficha por título dentro del listado.
 */

const { load } = require('cheerio');
const config = require('../config');
const { providerHttp, isNotFound } = require('../providerHttp');
const { extractEmbed, extractorFor, UA } = require('../extractors');
const { isDirectMedia } = require('../directMedia');
const { resolveVimeosEmbed, vimeosCacheSeconds } = require('../vimeos');
const { titleScore } = require('../providerTitles');
const cache = require('../cache');

const BASE = 'https://animeflv.or.at';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' };
const MAX_HTML = 2 * 1024 * 1024;
const VIMEOS_HOSTS = ['vimeos.net', 'vimeos.com', 'vimeos.zip', 'vimeos.xyz', 'vimeos.site', 'vimeos.org'];
// El player propio sirve el manifiesto sin extensión: `…/m3u8/<token hex>`.
const HLS_BY_PATH = /^https:\/\/player\.zilla-networks\.com\/m3u8\/[a-f0-9]{16,}$/i;
const OPAQUE_EXTRA = /(?:^|\.)(?:mp4upload|uns\.bio|zilla-networks)\./i;

const slugify = (title) => String(title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const hostOf = (raw) => { try { return new URL(raw).hostname; } catch { return ''; } };
const isVimeos = (raw) => VIMEOS_HOSTS.some((host) => hostOf(raw) === host || hostOf(raw).endsWith(`.${host}`));

/** «Ver <título> Online Sub Español - AnimeFLV» → `<título>`. */
function titleFromOg(value) {
  return String(value || '')
    .replace(/^Ver\s+/i, '')
    .replace(/\s+Online\b.*$/i, '')
    .replace(/\s+-\s+AnimeFLV\s*$/i, '')
    .replace(/\s+Sub\s+Espa(?:ñ|n)ol\s*$/i, '')
    .trim();
}

/**
 * El sitio nombra cada temporada como una obra aparte («Ao Ashi Season 2»,
 * «Black Clover 2nd Season», «… Part 2»), mientras que TMDB devuelve el título
 * base y la temporada por separado. Se aceptan esas formas: sin ellas, pedir
 * «Ao Ashi» T2 no encontraba nunca la ficha.
 */
function seasonSuffixes(season) {
  const number = Number(season);
  if (!Number.isFinite(number) || number < 2) return [];
  const ordinal = { 2: '2nd', 3: '3rd' }[number] || `${number}th`;
  return [`Season ${number}`, `${ordinal} Season`, `Part ${number}`, `${number}ª Temporada`, `Temporada ${number}`];
}

/** Nombres que puede llevar la ficha de la obra pedida. */
function titleVariants(resolved) {
  const base = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  const suffixes = resolved.mediaType === 'movie' ? [] : seasonSuffixes(resolved.season);
  // Si el propio título ya trae la temporada («… Season 2»), no se repite.
  const decorated = base.filter((title) => seasonOf(title) !== Number(resolved.season));
  return [...new Set([...base, ...decorated.flatMap((title) => suffixes.map((suffix) => `${title} ${suffix}`))])];
}

/**
 * Identidad de la ficha: solo el título. El sitio no publica año, así que no se
 * puede exigir; se pide coincidencia plena del título normalizado (el `og:title`
 * sirve de segunda opinión cuando el `h1` lleva sufijos de temporada).
 */
function matchDetail($, resolved) {
  const heading = $('h1.anime-title').first().text().replace(/\s+/g, ' ').trim();
  const og = titleFromOg($('meta[property="og:title"]').attr('content'));
  const names = [heading, og].filter(Boolean);
  return titleScore(names, titleVariants(resolved)) === 2;
}

/** Temporada declarada en el título de la ficha («… Season 2», «… 2nd Season»). */
function seasonOf(text) {
  const value = String(text || '');
  const explicit = /season\s*(\d+)/i.exec(value) || /(\d+)(?:st|nd|rd|th)\s+season/i.exec(value);
  return explicit ? Number(explicit[1]) : null;
}

/** Episodios publicados en la ficha: JSON embebido, sin ejecutar el JS. */
function episodesOf(html) {
  const $ = load(html);
  // El JSON va en un `<script>` marcado con la clase del bloque.
  const node = $('script.animeflv-episodes-data, .animeflv-episodes-data').first();
  const raw = (node.length ? node.text() : '').trim();
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** Episodio pedido por su número dentro del listado de la ficha. */
function pickEpisode(list, resolved) {
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (!entry || !entry.permalink) continue;
    if (Number(entry.number) !== Number(resolved.episode)) continue;
    return entry;
  }
  return null;
}

/**
 * Servidores del episodio: el embed viene en base64 en `data-src` y el nombre
 * del visor en el `.tooltip-text` hermano. `app_type` describe el audio («Sub»).
 */
function serversOf(html) {
  const $ = load(html);
  const out = [];
  for (const el of $('button.iframe_code[data-src], .iframe_code[data-src]').toArray()) {
    const node = $(el);
    const encoded = String(node.attr('data-src') || '').trim();
    let url = '';
    try { url = Buffer.from(encoded, 'base64').toString('utf8').trim(); } catch { url = ''; }
    if (!/^https?:\/\//.test(url)) continue;
    const name = node.closest('.button-container').find('.tooltip-text').first().text().trim()
      || node.text().replace(/\s+/g, ' ').trim();
    const audio = String(node.attr('app_type') || '').trim();
    if (!out.some((item) => item.url === url)) out.push({ url, name, audio });
    if (out.length >= 6) break;
  }
  return out;
}

/** Etiqueta de audio a partir de `app_type` («Sub» → Subtitulado). */
function audioOf(server) {
  const text = `${server?.audio || ''} ${server?.name || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/castellano/.test(text)) return 'Castellano';
  if (/latino/.test(text)) return 'Latino';
  if (/\bsub\b|subtitulad/.test(text)) return 'Subtitulado';
  return 'Subtitulado';
}

/** Manifiesto servido sin extensión bajo un host conocido del sitio. */
function hlsByPath(url) {
  return HLS_BY_PATH.test(String(url || '')) ? { url, kind: 'hls' } : null;
}

async function fetchText(http, url, referer) {
  return http.text(url, { headers: { ...HEADERS, ...(referer ? { Referer: referer } : {}) }, maxBytes: MAX_HTML });
}

/** Fichas candidatas del buscador del sitio, elegidas por título. */
function listingMatches(html, resolved) {
  const $ = load(html);
  const wanted = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  const found = [];
  for (const el of $('a[href*="/anime/"]').toArray()) {
    const raw = $(el).attr('href') || '';
    let url;
    try { url = new URL(raw, BASE); } catch { continue; }
    if (url.origin !== BASE || !/^\/anime\/[a-z0-9%-]+\/?$/.test(url.pathname)) continue;
    const label = ($(el).attr('title') || $(el).text() || $(el).find('img').attr('alt') || '')
      .replace(/\s+Anime\s*$/i, '').trim();
    if (titleScore([label], wanted) === 0) continue;
    if (!found.includes(url.href)) found.push(url.href);
    if (found.length >= 3) break;
  }
  return found;
}

async function mediaOf(http, server, referer, timeoutMs) {
  const direct = hlsByPath(server.url);
  if (direct) return { sources: [direct] };
  if (isVimeos(server.url)) {
    const cacheKey = `animeflv:vimeos:${server.url}`;
    const cached = cache.get(cacheKey);
    const media = cached ?? await resolveVimeosEmbed(server.url, referer, http);
    if (media && !cached) {
      const ttl = vimeosCacheSeconds(media.expiresAt);
      if (ttl > 0) cache.set(cacheKey, media, ttl);
    }
    if (!media) return null;
    return { sources: [{ url: media.master, kind: 'hls' }], subtitles: media.subtitles, expiresAt: media.expiresAt };
  }
  if (isDirectMedia(server.url)) return { sources: [{ url: server.url, kind: /\.mp4$/i.test(server.url) ? 'mp4' : 'hls' }] };
  const kind = extractorFor(server.url);
  if (!kind || kind === 'opaque' || OPAQUE_EXTRA.test(hostOf(server.url))) return { opaque: true };
  const extracted = await extractEmbed(server.url, { timeoutMs, referer });
  if (!extracted.ok) return { unsupported: true };
  return { sources: extracted.sources, subtitles: extracted.subtitles, audioLabel: extracted.audioLabel };
}

/**
 * Recorre una ficha candidata: identidad → episodios → servidores → medios.
 * Devuelve `null` si la ficha no es la obra pedida (para probar la siguiente).
 */
async function hitsFromPage(http, page, resolved, timeoutMs, series) {
  let html;
  try { html = await fetchText(http, page); }
  catch (err) { if (isNotFound(err, page)) return null; throw err; }
  const $ = load(html);
  if (!matchDetail($, resolved)) return null;

  const heading = $('h1.anime-title').first().text().replace(/\s+/g, ' ').trim();
  // Una ficha con «Season 2» no sirve para la temporada 1, y al revés.
  const declaredSeason = seasonOf(heading);
  if (series && declaredSeason) {
    const wanted = Number(resolved.season);
    if (wanted > 1 && declaredSeason !== wanted) return null;
    if (wanted === 1 && declaredSeason !== 1) return null;
  }

  const list = episodesOf(html);
  if (!list.length) return { hits: [], reason: 'no-episodes' };
  const episode = pickEpisode(list, resolved);
  if (!episode) return { hits: [], reason: 'no-episode' };

  let episodeHtml;
  try { episodeHtml = await fetchText(http, episode.permalink, page); }
  catch (err) { if (isNotFound(err, episode.permalink)) return { hits: [], reason: 'no-episode' }; throw err; }

  const servers = serversOf(episodeHtml);
  if (!servers.length) return { hits: [], reason: 'no-players' };

  // Primero los visores que sí publican el medio: el player propio (HLS
  // directo) y Byse; los opacos se cuentan y no se abren.
  const rank = (server) => {
    if (hlsByPath(server.url)) return 0;
    if (isVimeos(server.url)) return 1;
    const kind = extractorFor(server.url);
    return kind && kind !== 'opaque' ? 2 : 3;
  };
  const ordered = [...servers].sort((a, b) => rank(a) - rank(b)).slice(0, 4);

  const hits = [];
  const notes = { opaque: 0, extracted: 0, unsupported: 0 };
  for (const server of ordered) {
    const media = await mediaOf(http, server, episode.permalink, timeoutMs).catch(() => null);
    if (!media) { notes.unsupported += 1; continue; }
    if (media.opaque) { notes.opaque += 1; continue; }
    if (media.unsupported) { notes.unsupported += 1; continue; }
    notes.extracted += 1;
    const audio = audioOf(server) || media.audioLabel || 'Subtitulado';
    for (const source of media.sources) {
      if (!/^https:\/\//.test(source.url)) continue;
      hits.push({
        provider: 'animeflv',
        title: `${resolved.title}${series ? ` S${resolved.season}E${resolved.episode}` : ''} AnimeFLV`,
        url: source.url,
        quality: source.kind === 'mp4' ? 'MP4' : 'HLS',
        resolution: null,
        audioLabel: audio,
        ...(media.subtitles?.length ? { subtitles: media.subtitles } : {}),
        ...(media.expiresAt ? { expiresAt: media.expiresAt } : {}),
      });
    }
    // El player propio ya sirve el manifiesto: no se gasta otra petición. La
    // parada solo se acepta si el enlace pasa el filtro del registro; si no,
    // se sigue con los visores siguientes (Byse) para no quedarse sin nada.
    if (hits.length && rank(server) === 0 && hits.every((hit) => isDirectMedia(hit.url))) break;
    if (hits.length >= 3) break;
  }
  if (hits.length) return { hits };
  return { hits: [], reason: 'no-extractable-embed', notes };
}

async function searchAnimeFlv(_query, resolved, queryTitle, timeoutMs = config.streamProviderTimeoutMs) {
  if (!resolved) return { skipped: 'identity-required' };
  if (queryTitle && queryTitle !== resolved.title) return { skipped: 'alternative-already-checked' };
  const series = resolved.mediaType !== 'movie';
  if (series && !(resolved.season > 0 && resolved.episode > 0)) return { skipped: 'episode-required' };
  const titles = [resolved.title, resolved.altTitle].map((value) => String(value || '').trim()).filter(Boolean);
  if (!titles.length) return { skipped: 'identity-required' };
  const http = providerHttp(timeoutMs, 8);

  // El slug de una temporada suele ser `<título>-season-<N>`: se prueba primero
  // esa forma y después el título base, sin disparar el número de peticiones.
  const pages = [...new Set(titleVariants(resolved).map((title) => `${BASE}/anime/${slugify(title)}/`))]
    .filter((url) => url !== `${BASE}/anime/`).slice(0, 4);
  for (const page of pages) {
    const result = await hitsFromPage(http, page, resolved, timeoutMs, series);
    if (result) return result;
  }

  // Respaldo: el buscador del sitio (devuelve el archivo, no filtra) y
  // coincidencia por título dentro del listado, por si el slug no es el real.
  for (const title of titles.slice(0, 1)) {
    let listing = '';
    try { listing = await fetchText(http, `${BASE}/search/${encodeURIComponent(slugify(title))}/`, `${BASE}/`); }
    catch { listing = ''; }
    for (const page of listing ? listingMatches(listing, resolved) : []) {
      const result = await hitsFromPage(http, page, resolved, timeoutMs, series);
      if (result) return result;
    }
  }
  return { hits: [], reason: 'no-match' };
}

module.exports = {
  BASE, slugify, titleFromOg, matchDetail, seasonOf, seasonSuffixes, titleVariants, episodesOf, pickEpisode, serversOf, audioOf, hlsByPath, listingMatches, hitsFromPage, searchAnimeFlv,
};
